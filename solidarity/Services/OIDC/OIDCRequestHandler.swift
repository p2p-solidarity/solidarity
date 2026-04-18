//
//  OIDCRequestHandler.swift
//  solidarity
//
//  Handles incoming OIDC authorization requests for vault access.
//  Parses inbound requests, generates permission-prompt data for the UI,
//  and delegates authorization-code/token minting to OIDCTokenService so
//  there is a single source of truth for code lifecycle.
//

import Foundation

@MainActor
final class OIDCRequestHandler {
    static let shared = OIDCRequestHandler()

    private let vault = SovereignVaultService.shared
    private let tokenService = OIDCTokenService.shared
    private var pendingRequests: [String: OIDCAuthorizationRequest] = [:]
    private let pendingRequestsLock = NSLock()

    // Registry of trusted client identifiers. Matched exactly against either
    // the full clientId or its reversed-DNS prefix (e.g. "gg.solidarity" or
    // "com.example.app"). Substring contains-matching is unsafe because an
    // attacker can register e.g. "evil-solidarity.com" and impersonate us.
    private static let trustedClientIds: Set<String> = [
        "solidarity",
        "gg.solidarity",
        "kidneyweakx.solidarity",
        "kidneyweakx.airmeishi",
        "aniseekr",
        "com.aniseekr.app",
    ]

    private static let clientDisplayNames: [String: String] = [
        "solidarity": "Solidarity",
        "gg.solidarity": "Solidarity",
        "kidneyweakx.solidarity": "Solidarity",
        "kidneyweakx.airmeishi": "AirMeishi",
        "aniseekr": "AniSeekr",
        "com.aniseekr.app": "AniSeekr",
    ]

    private init() {}

    // MARK: - Public API

    /// Parse incoming OIDC authorization request from URL
    func parseAuthorizationRequest(from url: URL) -> OIDCAuthorizationRequest? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let queryItems = components.queryItems else {
            return nil
        }

        guard let clientId = queryItems.first(where: { $0.name == "client_id" })?.value,
              !clientId.isEmpty else {
            return nil
        }

        guard let redirectUri = queryItems.first(where: { $0.name == "redirect_uri" })?.value,
              !redirectUri.isEmpty else {
            return nil
        }
        guard let state = queryItems.first(where: { $0.name == "state" })?.value,
              !state.isEmpty else {
            return nil
        }
        guard let nonce = queryItems.first(where: { $0.name == "nonce" })?.value,
              !nonce.isEmpty else {
            return nil
        }

        let scopeStrings = queryItems.first { $0.name == "scope" }?.value?
            .components(separatedBy: " ") ?? []
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

        pendingRequestsLock.lock()
        pendingRequests[state] = request
        pendingRequestsLock.unlock()
        return request
    }

    /// Validate the requesting client
    func validateClient(_ clientId: String) async throws -> OIDCClientInfo {
        OIDCClientInfo(
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
        grantedScopes: [OIDCScope] = [],
        codeChallenge: String? = nil,
        codeChallengeMethod: String? = nil
    ) async throws -> OIDCAuthorizationResponse {
        // This method is @MainActor + async — reads/writes to pendingRequests
        // are already serialized by the main actor, so no lock is needed here.
        // The lock in parseAuthorizationRequest(_:) guards against legacy
        // non-strict-concurrency callers that bypass actor isolation.
        pendingRequests.removeValue(forKey: request.state)

        guard decision == .approved else {
            return OIDCAuthorizationResponse(
                state: request.state,
                code: nil,
                grantedScopes: []
            )
        }

        let code = tokenService.generateAuthorizationCode(
            for: request,
            grantedScopes: grantedScopes,
            codeChallenge: codeChallenge,
            codeChallengeMethod: codeChallengeMethod
        )

        return OIDCAuthorizationResponse(
            state: request.state,
            code: code,
            grantedScopes: grantedScopes
        )
    }

    /// Build the response URL
    func buildResponseURL(
        for response: OIDCAuthorizationResponse,
        originalRedirectUri: String
    ) -> URL? {
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
        let normalized = normalizeClientId(clientId)
        if let known = Self.clientDisplayNames[normalized] {
            return known
        }
        if let lastPath = clientId.components(separatedBy: CharacterSet(charactersIn: ".:/")).last,
           !lastPath.isEmpty {
            return lastPath.capitalized
        }
        return clientId
    }

    private func isTrustedClient(_ clientId: String) -> Bool {
        Self.trustedClientIds.contains(normalizeClientId(clientId))
    }

    private func normalizeClientId(_ clientId: String) -> String {
        // Strip scheme for DID/URL-style ids, lowercase, and trim.
        var value = clientId.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if let schemeEnd = value.range(of: "://") {
            value = String(value[schemeEnd.upperBound...])
        }
        if value.hasPrefix("did:") {
            // Keep DIDs as-is so they match registered DID clients.
            return value
        }
        // Drop any trailing path so "gg.solidarity/callback" == "gg.solidarity".
        if let slashIdx = value.firstIndex(of: "/") {
            value = String(value[..<slashIdx])
        }
        return value
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
