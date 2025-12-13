import Foundation
import LocalAuthentication
import Combine

/// Helper class to handle identity import logic, reducing complexity in IdentityCoordinator
class IdentityImportHelper {
    private let oidcService: OIDCService
    private let vcService: VCService
    private let semaphoreManager: SemaphoreIdentityManager
    
    init(
        oidcService: OIDCService,
        vcService: VCService,
        semaphoreManager: SemaphoreIdentityManager
    ) {
        self.oidcService = oidcService
        self.vcService = vcService
        self.semaphoreManager = semaphoreManager
    }
    
    func resolvePayload(
        from source: IdentityImportSource,
        context: LAContext?
    ) -> CardResult<IdentityImportResult.Payload> {
        switch source {
        case .oidcResponse(let url):
            return oidcService.handleResponse(url: url, vcService: vcService)
                .map { .credential($0.storedCredential) }

        case .qrPayload(let raw), .clipboard(let raw):
            return parseRawPayload(raw)

        case .fileURL(let url):
            do {
                let data = try Data(contentsOf: url)
                if let string = String(data: data, encoding: .utf8), !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    return parseRawPayload(string)
                }
                return parseBinaryPayload(data)
            } catch {
                return .failure(.invalidData("Failed to read identity file: \(error.localizedDescription)"))
            }
        }
    }

    private func parseRawPayload(_ raw: String, allowBase64Retry: Bool = true) -> CardResult<IdentityImportResult.Payload> {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .failure(.invalidData("Import payload is empty"))
        }

        if let url = URL(string: trimmed), trimmed.hasPrefix("airmeishi://oidc") {
            return resolvePayload(from: .oidcResponse(url), context: nil)
        }

        if trimmed.hasPrefix("openid-vc://") || trimmed.hasPrefix("openid://") {
            return oidcService.parseRequest(from: trimmed)
                .map { .presentationRequest($0) }
        }

        if let data = trimmed.data(using: .utf8) {
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .useDefaultKeys

            if let document = try? decoder.decode(DIDDocument.self, from: data) {
                return .success(.didDocument(document))
            }

            if let jwk = try? decoder.decode(PublicKeyJWK.self, from: data) {
                return .success(.publicJwk(jwk, did: nil))
            }

            if let payload = parseEnvelopePayload(from: data) {
                return payload
            }
        }

        let jwtSegments = trimmed.split(separator: ".")
        if jwtSegments.count == 3 {
            return importCredential(jwt: trimmed)
        }

        if allowBase64Retry, let data = Data(base64Encoded: trimmed) {
            if data.count == 32 || data.count == 64 {
                return importSemaphoreIdentity(privateKey: data)
            }

            if let string = String(data: data, encoding: .utf8), string != trimmed {
                return parseRawPayload(string, allowBase64Retry: false)
            }
        }

        return .failure(.invalidData("Unsupported identity payload format"))
    }

    private func parseBinaryPayload(_ data: Data) -> CardResult<IdentityImportResult.Payload> {
        if data.count == 32 || data.count == 64 {
            return importSemaphoreIdentity(privateKey: data)
        }

        if let string = String(data: data, encoding: .utf8) {
            return parseRawPayload(string)
        }

        return .failure(.invalidData("Binary payload cannot be parsed as identity data"))
    }

    private func parseEnvelopePayload(from data: Data) -> CardResult<IdentityImportResult.Payload>? {
        guard
            let object = try? JSONSerialization.jsonObject(with: data, options: []),
            let json = object as? [String: Any]
        else { return nil }

        if let documentJSON = json["document"] {
            if let docData = try? JSONSerialization.data(withJSONObject: documentJSON),
               let document = try? JSONDecoder().decode(DIDDocument.self, from: docData) {
                return .success(.didDocument(document))
            }
        }

        if let jwkJSON = json["jwk"] {
            if let jwkData = try? JSONSerialization.data(withJSONObject: jwkJSON),
               let jwk = try? JSONDecoder().decode(PublicKeyJWK.self, from: jwkData) {
                let didHint = json["did"] as? String
                return .success(.publicJwk(jwk, did: didHint))
            }
        }

        if let jwkString = json["jwk"] as? String,
           let jwkData = jwkString.data(using: .utf8),
           let jwk = try? JSONDecoder().decode(PublicKeyJWK.self, from: jwkData) {
            let didHint = json["did"] as? String
            return .success(.publicJwk(jwk, did: didHint))
        }

        if let privateKey = json["privateKey"] as? String ?? json["semaphorePrivateKey"] as? String,
           let data = Data(base64Encoded: privateKey) {
            return importSemaphoreIdentity(privateKey: data)
        }

        if let credential = json["credential"] as? String {
            return importCredential(jwt: credential)
        }

        return nil
    }

    private func importCredential(jwt: String) -> CardResult<IdentityImportResult.Payload> {
        vcService.importPresentedCredential(jwt: jwt)
            .map { .credential($0.storedCredential) }
    }

    private func importSemaphoreIdentity(privateKey: Data) -> CardResult<IdentityImportResult.Payload> {
        do {
            let bundle = try semaphoreManager.importIdentity(privateKey: privateKey)
            return .success(.zkIdentity(bundle))
        } catch {
            return .failure(.cryptographicError("Failed to import Semaphore identity: \(error.localizedDescription)"))
        }
    }
}
