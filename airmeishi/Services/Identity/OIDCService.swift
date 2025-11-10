//
//  OIDCService.swift
//  airmeishi
//
//  Lightweight helpers for crafting and handling OIDC4VP-style presentation requests.
//

import Foundation

/// Manages offline OIDC4VP presentation requests and responses.
final class OIDCService: ObservableObject {
    struct PresentationRequestContext {
        let request: PresentationRequest
        let qrString: String
        let createdAt: Date
    }

    struct PresentationRequest: Codable, Equatable {
        let clientId: String
        let redirectURI: String
        let responseType: String
        let responseMode: String
        let scope: String
        let state: String
        let nonce: String
        let presentationDefinition: PresentationDefinition

        enum CodingKeys: String, CodingKey {
            case clientId = "client_id"
            case redirectURI = "redirect_uri"
            case responseType = "response_type"
            case responseMode = "response_mode"
            case scope
            case state
            case nonce
            case presentationDefinition = "presentation_definition"
        }
    }

    struct PresentationDefinition: Codable, Equatable {
        struct InputDescriptor: Codable, Equatable {
            struct Constraints: Codable, Equatable {
                struct Field: Codable, Equatable {
                    struct Filter: Codable, Equatable {
                        let type: String
                        let pattern: String?
                        let const: String?
                    }

                    let path: [String]
                    let filter: Filter
                }

                let fields: [Field]
            }

            let id: String
            let name: String
            let purpose: String?
            let constraints: Constraints
        }

        let id: String
        let inputDescriptors: [InputDescriptor]

        enum CodingKeys: String, CodingKey {
            case id
            case inputDescriptors = "input_descriptors"
        }
    }

    static let shared = OIDCService()

    private let queue = DispatchQueue(label: "com.kidneyweakx.airmeishi.oidc", qos: .userInitiated)
    private var activeRequests: [String: PresentationRequest] = [:] // keyed by state

    private init() {}

    // MARK: - Request creation

    func createPresentationRequest(
        expectedSubjectType: String = "BusinessCardSubject",
        redirectURI: URL = URL(string: "airmeishi://oidc/callback")!
    ) -> CardResult<PresentationRequestContext> {
        let state = UUID().uuidString
        let nonce = UUID().uuidString

        let definition = PresentationDefinition(
            id: "business-card-\(state.prefix(6))",
            inputDescriptors: [
                PresentationDefinition.InputDescriptor(
                    id: "business-card-credential",
                    name: "Business Card Credential",
                    purpose: "Requesting a verifiable business card",
                    constraints: .init(
                        fields: [
                            .init(
                                path: ["$.credentialSubject.type"],
                                filter: .init(
                                    type: "string",
                                    pattern: nil,
                                    const: expectedSubjectType
                                )
                            )
                        ]
                    )
                )
            ]
        )

        let request = PresentationRequest(
            clientId: redirectURI.absoluteString,
            redirectURI: redirectURI.absoluteString,
            responseType: "vp_token",
            responseMode: "direct_post",
            scope: "openid",
            state: state,
            nonce: nonce,
            presentationDefinition: definition
        )

        do {
            let qrString = try encodeRequest(request)
            let context = PresentationRequestContext(request: request, qrString: qrString, createdAt: Date())
            register(request: request)
            return .success(context)
        } catch {
            return .failure(.invalidData("Failed to encode presentation request: \(error.localizedDescription)"))
        }
    }

    // MARK: - Request parsing

    func parseRequest(from urlString: String) -> CardResult<PresentationRequest> {
        guard let url = URL(string: urlString),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else {
            return .failure(.invalidData("Malformed OIDC request URL"))
        }

        guard
            (components.scheme == "openid-vc" || components.scheme == "openid"),
            let requestItem = components.queryItems?.first(where: { $0.name == "request" }),
            let requestValue = requestItem.value,
            let data = Data(base64URLEncoded: requestValue)
        else {
            return .failure(.invalidData("Unsupported OIDC request format"))
        }

        do {
            let request = try JSONDecoder().decode(PresentationRequest.self, from: data)
            return .success(request)
        } catch {
            return .failure(.invalidData("Failed to decode presentation request: \(error.localizedDescription)"))
        }
    }

    // MARK: - Response handling

    func buildResponseURL(for request: PresentationRequest, vpToken: String) -> CardResult<URL> {
        guard var components = URLComponents(string: request.redirectURI) else {
            return .failure(.invalidData("Invalid redirect URI \(request.redirectURI)"))
        }

        var items = components.queryItems ?? []
        items.append(URLQueryItem(name: "state", value: request.state))
        items.append(URLQueryItem(name: "vp_token", value: vpToken))
        components.queryItems = items

        guard let url = components.url else {
            return .failure(.invalidData("Failed to construct presentation response URL"))
        }

        return .success(url)
    }

    /// Parses a callback URL and imports the credential via VCService.
    func handleResponse(
        url: URL,
        vcService: VCService
    ) -> CardResult<VCService.ImportedCredential> {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return .failure(.invalidData("Malformed OIDC callback URL"))
        }

        guard components.scheme == "airmeishi", components.host == "oidc" else {
            return .failure(.invalidData("Unsupported OIDC callback scheme"))
        }

        let stateItem = components.queryItems?.first(where: { $0.name == "state" })
        let tokenItem = components.queryItems?.first(where: { $0.name == "vp_token" })

        guard
            let state = stateItem?.value,
            let vpToken = tokenItem?.value
        else {
            return .failure(.invalidData("Missing vp_token or state in callback"))
        }

        guard resolveRequest(state: state) != nil else {
            return .failure(.notFound("No active request for state \(state)"))
        }

        switch vcService.importPresentedCredential(jwt: vpToken) {
        case .failure(let error):
            return .failure(error)
        case .success(let imported):
            removeRequest(state: state)
            return .success(imported)
        }
    }

    // MARK: - Internal helpers

    private func encodeRequest(_ request: PresentationRequest) throws -> String {
        let data = try JSONEncoder().encode(request)
        let encoded = data.base64URLEncodedString()
        return "openid-vc://?request=\(encoded)"
    }

    private func register(request: PresentationRequest) {
        queue.async {
            self.activeRequests[request.state] = request
        }
    }

    private func resolveRequest(state: String) -> PresentationRequest? {
        var request: PresentationRequest?
        queue.sync {
            request = activeRequests[state]
        }
        return request
    }

    private func removeRequest(state: String) {
        queue.async {
            self.activeRequests.removeValue(forKey: state)
        }
    }
}


