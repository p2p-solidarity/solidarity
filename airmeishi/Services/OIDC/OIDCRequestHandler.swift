//
//  OIDCRequestHandler.swift
//  airmeishi
//
//  Handles incoming OIDC authorization requests for vault access
//

import Foundation

@MainActor
final class OIDCRequestHandler {
    static let shared = OIDCRequestHandler()

    private let vault = SovereignVaultService.shared
    private var pendingRequests: [String: OIDCAuthorizationRequest] = [:]

    private init() {}

    // MARK: - Public API

    /// Parse incoming OIDC authorization request from URL
    func parseAuthorizationRequest(from url: URL) -> OIDCAuthorizationRequest? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let queryItems = components.queryItems else {
            return nil
        }

        let clientId = queryItems.first { $0.name == "client_id" }?.value ?? "unknown"
        let redirectUri = queryItems.first { $0.name == "redirect_uri" }?.value ?? "airmeishi://oidc-callback"
        let state = queryItems.first { $0.name == "state" }?.value ?? UUID().uuidString
        let nonce = queryItems.first { $0.name == "nonce" }?.value ?? UUID().uuidString

        let scopeStrings = queryItems.first { $0.name == "scope" }?.value?.components(separatedBy: " ") ?? []
        let scopes = scopeStrings.compactMap { OIDCScope(rawValue: $0) }

        let request = OIDCAuthorizationRequest(
            id: UUID(),
            clientId: clientId,
            redirectUri: redirectUri,
            state: state,
            nonce: nonce,
            scopes: scopes,
            presentationDefinition: nil,
            requestedAt: Date()
        )

        pendingRequests[state] = request
        return request
    }

    /// Validate the requesting client
    func validateClient(_ clientId: String) async throws -> OIDCClientInfo {
        // For now, create a basic client info
        // In production, this would check against a registry
        return OIDCClientInfo(
            clientId: clientId,
            displayName: displayNameForClient(clientId),
            iconURL: nil,
            trusted: isTrustedClient(clientId)
        )
    }

    /// Generate permission request UI data
    func generatePermissionRequest(from request: OIDCAuthorizationRequest) -> PermissionRequest {
        let clientInfo = OIDCClientInfo(
            clientId: request.clientId,
            displayName: displayNameForClient(request.clientId),
            iconURL: nil,
            trusted: isTrustedClient(request.clientId)
        )

        let requiresConsent = request.scopes.contains { $0.requiresUserConfirmation }

        return PermissionRequest(
            id: request.id,
            clientInfo: clientInfo,
            scopes: request.scopes,
            resourceHint: resourceHint(for: request.scopes),
            requestedAt: request.requestedAt,
            requiresExplicitConsent: requiresConsent
        )
    }

    /// Handle user approval/denial
    func handlePermissionDecision(
        request: OIDCAuthorizationRequest,
        decision: PermissionDecision,
        grantedScopes: [OIDCScope] = []
    ) async throws -> OIDCAuthorizationResponse {
        pendingRequests.removeValue(forKey: request.state)

        guard decision == .approved else {
            return OIDCAuthorizationResponse(
                state: request.state,
                code: nil,
                grantedScopes: []
            )
        }

        let code = generateAuthorizationCode(for: request, scopes: grantedScopes)

        return OIDCAuthorizationResponse(
            state: request.state,
            code: code,
            grantedScopes: grantedScopes
        )
    }

    /// Build the response URL
    func buildResponseURL(for response: OIDCAuthorizationResponse, originalRedirectUri: String) -> URL? {
        guard var components = URLComponents(string: originalRedirectUri) else {
            return nil
        }

        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "state", value: response.state)
        ]

        if let code = response.code {
            queryItems.append(URLQueryItem(name: "code", value: code))
        }

        components.queryItems = queryItems
        return components.url
    }

    /// Handle incoming data from external app (after authorization)
    func handleIncomingData(
        _ data: Data,
        for requestId: String,
        metadata: VaultMetadata
    ) async throws -> VaultItem {
        guard let item = try? await vault.importData(
            data,
            name: metadata.originalFileName ?? "Imported Data",
            contentType: metadata.contentType,
            sourceApp: "OIDC:\(requestId)"
        ) else {
            throw OIDCHandlerError.importFailed
        }
        return item
    }

    // MARK: - Private Methods

    private func displayNameForClient(_ clientId: String) -> String {
        let knownClients: [String: String] = [
            "aniseekr": "AniSeekr",
            "solidarity": "Solidarity",
            "mygame": "My Game"
        ]

        for (key, name) in knownClients where clientId.lowercased().contains(key.lowercased()) {
            return name
        }

        return clientId.components(separatedBy: ".").first?.capitalized ?? clientId
    }

    private func isTrustedClient(_ clientId: String) -> Bool {
        let trustedClients = ["solidarity", "aniseekr"]
        return trustedClients.contains { clientId.lowercased().contains($0) }
    }

    private func resourceHint(for scopes: [OIDCScope]) -> String? {
        if scopes.contains(.backupWrite) || scopes.contains(.backupRead) {
            return "Backup data"
        }
        if scopes.contains(.preferences) || scopes.contains(.configSync) {
            return "App preferences"
        }
        if scopes.contains(.ageOver18) {
            return "Age verification"
        }
        if scopes.contains(.decryptContent) {
            return "Shared content"
        }
        return nil
    }

    private func generateAuthorizationCode(for request: OIDCAuthorizationRequest, scopes: [OIDCScope]) -> String {
        let codeData = Data("\(request.clientId)|\(request.nonce)|\(Date().timeIntervalSince1970)".utf8)
        return codeData.base64EncodedString()
    }
}

// MARK: - Errors

enum OIDCHandlerError: LocalizedError {
    case invalidRequest
    case clientNotFound
    case importFailed
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .invalidRequest: return "Invalid OIDC request"
        case .clientNotFound: return "Client not found"
        case .importFailed: return "Failed to import data"
        case .unauthorized: return "Unauthorized"
        }
    }
}
