//
//  OIDCTokenService.swift
//  solidarity
//
//  Authorization-server side of the OIDC/OAuth stack: mints authorization
//  codes, exchanges them for access + ID tokens, and validates issued
//  tokens. All signing uses the user's did:key-derived SE-backed pairwise
//  key (via KeychainService), not a bare P-256 blob.
//

import CryptoKit
import Foundation
import LocalAuthentication
import os

// MARK: - OIDC Token Service

final class OIDCTokenService {
    static let shared = OIDCTokenService()
    static let logger = Logger(subsystem: AppBranding.currentLoggerSubsystem, category: "OIDCTokenService")

    // Reserved audience used by the vault's authorization server when
    // the client has not registered a DID.
    private let issuerScheme = "\(AppBranding.currentScheme)-vault"

    private let tokenExpiry: TimeInterval = 3600 // 1 hour
    private let codeExpiry: TimeInterval = 600   // 10 minutes

    private let stateLock = NSLock()
    private var authorizationCodes: [String: AuthorizationCodeEntry] = [:]
    private var accessTokens: [String: AccessTokenEntry] = [:]
    private var usedJtis: [String: Date] = [:]
    private var cleanupTimer: Timer?

    private let keychain: KeychainService
    private let didService: DIDService

    init(
        keychain: KeychainService = .shared,
        didService: DIDService = DIDService()
    ) {
        self.keychain = keychain
        self.didService = didService
        scheduleCleanup()
    }

    deinit {
        cleanupTimer?.invalidate()
    }

    // MARK: - Authorization Code

    /// Generate an authorization code for an approved request. `codeChallenge`
    /// and `codeChallengeMethod` are stored for later PKCE verification at the
    /// token endpoint. When omitted, PKCE is not required for this code.
    func generateAuthorizationCode(
        for request: OIDCAuthorizationRequest,
        grantedScopes: [OIDCScope],
        codeChallenge: String? = nil,
        codeChallengeMethod: String? = nil
    ) -> String {
        let code = Self.randomURLSafeToken(byteCount: 32)

        let entry = AuthorizationCodeEntry(
            code: code,
            clientId: request.clientId,
            redirectUri: request.redirectUri,
            scopes: grantedScopes,
            nonce: request.nonce,
            createdAt: Date(),
            expiresAt: Date().addingTimeInterval(codeExpiry),
            codeChallenge: codeChallenge,
            codeChallengeMethod: codeChallengeMethod?.lowercased()
        )

        stateLock.lock()
        authorizationCodes[code] = entry
        stateLock.unlock()
        return code
    }

    /// Exchange authorization code for tokens. Verifies one-time use, redirect
    /// URI equality, client binding, and PKCE challenge (when registered).
    func exchangeCode(
        _ code: String,
        clientId: String,
        redirectUri: String,
        codeVerifier: String? = nil
    ) throws -> TokenResponse {
        stateLock.lock()
        guard let entry = authorizationCodes[code] else {
            stateLock.unlock()
            throw OIDCTokenError.invalidCode
        }
        // Invalidate immediately — codes are strictly one-time use even if
        // subsequent validation fails.
        authorizationCodes.removeValue(forKey: code)
        stateLock.unlock()

        guard entry.expiresAt > Date() else {
            throw OIDCTokenError.codeExpired
        }

        guard entry.clientId == clientId else {
            throw OIDCTokenError.clientMismatch
        }

        guard Self.redirectURIsMatch(entry.redirectUri, redirectUri) else {
            throw OIDCTokenError.redirectMismatch
        }

        // PKCE is enforced unconditionally. The authorization endpoint
        // (OIDCRequestHandler.parseAuthorizationRequest) refuses to mint a
        // code without a registered challenge; if we still got here with
        // `codeChallenge == nil` it is a programming error in the caller,
        // so we fail closed via `pkceFailed` rather than silently accept.
        guard let challenge = entry.codeChallenge else {
            Self.logger.error("PKCE challenge missing on authorization code — refusing exchange")
            throw OIDCTokenError.pkceFailed
        }
        guard let verifier = codeVerifier, !verifier.isEmpty else {
            throw OIDCTokenError.pkceRequired
        }
        guard Self.verifyPKCE(
            verifier: verifier,
            challenge: challenge,
            method: entry.codeChallengeMethod ?? "s256"
        ) else {
            throw OIDCTokenError.pkceFailed
        }

        let accessToken = try generateAccessToken(
            clientId: clientId,
            scopes: entry.scopes,
            nonce: entry.nonce
        )

        let idToken = try generateIDToken(
            clientId: clientId,
            scopes: entry.scopes,
            nonce: entry.nonce
        )

        return TokenResponse(
            accessToken: accessToken,
            tokenType: "Bearer",
            expiresIn: Int(tokenExpiry),
            idToken: idToken,
            scope: entry.scopes.map { $0.rawValue }.joined(separator: " ")
        )
    }

    /// Validate an access token
    func validateAccessToken(_ token: String) -> AccessTokenValidation? {
        stateLock.lock()
        defer { stateLock.unlock() }

        guard let entry = accessTokens[token] else {
            return nil
        }

        guard entry.expiresAt > Date() else {
            accessTokens.removeValue(forKey: token)
            return nil
        }

        return AccessTokenValidation(
            clientId: entry.clientId,
            scopes: entry.scopes,
            expiresAt: entry.expiresAt
        )
    }

    /// Revoke a token
    func revokeToken(_ token: String) {
        stateLock.lock()
        accessTokens.removeValue(forKey: token)
        stateLock.unlock()
    }

    // MARK: - JWT Generation

    /// Generate a signed access token
    private func generateAccessToken(
        clientId: String,
        scopes: [OIDCScope],
        nonce: String
    ) throws -> String {
        let subject = try currentSubject(for: clientId)
        let now = Date()
        let exp = now.addingTimeInterval(tokenExpiry)

        let payload = AccessTokenPayload(
            iss: subject.issuer,
            sub: subject.did,
            aud: clientId,
            exp: Int(exp.timeIntervalSince1970),
            iat: Int(now.timeIntervalSince1970),
            jti: UUID().uuidString,
            scope: scopes.map { $0.rawValue }.joined(separator: " ")
        )

        let token = try signJWT(payload: payload, kid: subject.verificationMethodId, signingKey: subject.signingKey)

        stateLock.lock()
        accessTokens[token] = AccessTokenEntry(
            clientId: clientId,
            scopes: scopes,
            createdAt: now,
            expiresAt: exp
        )
        stateLock.unlock()

        return token
    }

    /// Generate a signed ID token
    private func generateIDToken(
        clientId: String,
        scopes: [OIDCScope],
        nonce: String
    ) throws -> String {
        let subject = try currentSubject(for: clientId)
        let now = Date()
        let exp = now.addingTimeInterval(tokenExpiry)

        var claims = IDTokenClaims(
            iss: subject.issuer,
            sub: subject.did,
            aud: clientId,
            exp: Int(exp.timeIntervalSince1970),
            iat: Int(now.timeIntervalSince1970),
            nonce: nonce,
            authTime: Int(now.timeIntervalSince1970)
        )

        if scopes.contains(.ageOver18) {
            claims.ageVerification = AgeVerificationClaim(
                over18: true,
                verifiedAt: Int(now.timeIntervalSince1970),
                method: "self_declared"
            )
        }

        return try signJWT(payload: claims, kid: subject.verificationMethodId, signingKey: subject.signingKey)
    }

    /// Sign a JWT payload with the user's SE-backed pairwise key.
    private func signJWT<T: Encodable>(
        payload: T,
        kid: String,
        signingKey: BiometricSigningKey
    ) throws -> String {
        let header = OIDCJWTHeader(alg: "ES256", typ: "JWT", kid: kid)

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let headerData = try encoder.encode(header)
        let payloadData = try encoder.encode(payload)

        let headerB64 = headerData.base64URLEncodedString()
        let payloadB64 = payloadData.base64URLEncodedString()

        let signingInput = "\(headerB64).\(payloadB64)"
        guard let inputData = signingInput.data(using: .utf8) else {
            throw OIDCTokenError.encodingError
        }

        do {
            let signature = try signingKey.sign(payload: inputData)
            return "\(signingInput).\(signature.base64URLEncodedString())"
        } catch {
            Self.logger.error("OIDC JWT signing failed: \(error.localizedDescription, privacy: .public)")
            throw OIDCTokenError.signingFailed
        }
    }

    /// Resolve the subject (holder DID) and an appropriate SE-backed signing
    /// key for a given RP client. Uses a pairwise key when the client binds
    /// to an HTTPS redirect; otherwise uses the master signing key.
    private func currentSubject(for clientId: String) throws -> TokenSubject {
        let issuerIdentifier = issuerScheme
        let contextResult = keychain.authenticationContext(reason: "Sign OIDC token")
        guard case .success(let context) = contextResult else {
            throw OIDCTokenError.keyCreationFailed
        }

        let relyingPartyDomain = Self.host(forClientId: clientId)
        let descriptorResult = didService.currentDescriptor(for: relyingPartyDomain, context: context)
        guard case .success(let descriptor) = descriptorResult else {
            throw OIDCTokenError.keyCreationFailed
        }

        let signingKeyResult: CardResult<BiometricSigningKey>
        if let domain = relyingPartyDomain {
            signingKeyResult = keychain.pairwiseSigningKey(for: domain, context: context)
        } else {
            signingKeyResult = keychain.signingKey(context: context)
        }
        guard case .success(let signingKey) = signingKeyResult else {
            throw OIDCTokenError.keyCreationFailed
        }

        return TokenSubject(
            did: descriptor.did,
            verificationMethodId: descriptor.verificationMethodId,
            issuer: issuerIdentifier,
            signingKey: signingKey
        )
    }

    // MARK: - Cleanup

    private func scheduleCleanup() {
        // Timer is weak-self'd but we also explicitly invalidate in deinit
        // so the timer never outlives the service.
        let timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.cleanupExpiredTokens()
        }
        timer.tolerance = 10
        self.cleanupTimer = timer
    }

    /// Cleanup expired tokens
    private func cleanupExpiredTokens() {
        let now = Date()
        stateLock.lock()
        authorizationCodes = authorizationCodes.filter { $0.value.expiresAt > now }
        accessTokens = accessTokens.filter { $0.value.expiresAt > now }
        // Garbage-collect replay-suppression entries older than 1 hour.
        usedJtis = usedJtis.filter { now.timeIntervalSince($0.value) < 3600 }
        stateLock.unlock()
    }

    // MARK: - Nonce / Replay Suppression

    /// Record a previously-seen JWT ID. Returns true if this jti is new,
    /// false if it has been seen within the replay window.
    @discardableResult
    func recordJTI(_ jti: String, expiresAt: Date = Date().addingTimeInterval(3600)) -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        if usedJtis[jti] != nil {
            return false
        }
        usedJtis[jti] = expiresAt
        return true
    }

    // MARK: - Static Helpers

    static func redirectURIsMatch(_ lhs: String, _ rhs: String) -> Bool {
        guard let l = URLComponents(string: lhs),
              let r = URLComponents(string: rhs) else {
            return lhs == rhs
        }

        // Normalize: scheme + lowercase host + port + path (trailing slash trimmed)
        // + sorted query params. Fragment is intentionally ignored (spec §3.1.2.1).
        func normalize(_ c: URLComponents) -> String {
            let scheme = (c.scheme ?? "").lowercased()
            let host = (c.host ?? "").lowercased()
            let port = c.port.map { ":\($0)" } ?? ""
            var path = c.path
            if path.count > 1 && path.hasSuffix("/") { path.removeLast() }
            let items = (c.queryItems ?? []).sorted { $0.name < $1.name }
            let query = items
                .map { "\($0.name)=\($0.value ?? "")" }
                .joined(separator: "&")
            return "\(scheme)://\(host)\(port)\(path)\(query.isEmpty ? "" : "?" + query)"
        }

        return normalize(l) == normalize(r)
    }

    static func verifyPKCE(verifier: String, challenge: String, method: String) -> Bool {
        switch method.lowercased() {
        case "s256":
            let digest = SHA256.hash(data: Data(verifier.utf8))
            let encoded = Data(digest).base64URLEncodedString()
            return encoded == challenge
        default:
            return false
        }
    }

    static func randomURLSafeToken(byteCount: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        _ = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
        return Data(bytes).base64URLEncodedString()
    }

    /// Extract a domain from an HTTPS clientId. Returns nil when the
    /// clientId is a DID, a bare identifier, or a custom scheme.
    static func host(forClientId clientId: String) -> String? {
        guard let comps = URLComponents(string: clientId),
              let scheme = comps.scheme?.lowercased() else {
            return nil
        }
        if scheme == "https" {
            return comps.host
        }
        return nil
    }
}

// MARK: - JWT Types

private struct OIDCJWTHeader: Codable {
    let alg: String
    let typ: String
    let kid: String
}

struct AccessTokenPayload: Codable {
    let iss: String
    let sub: String
    let aud: String
    let exp: Int
    let iat: Int
    let jti: String
    let scope: String
}

struct IDTokenClaims: Codable {
    let iss: String
    let sub: String
    let aud: String
    let exp: Int
    let iat: Int
    let nonce: String
    let authTime: Int
    var ageVerification: AgeVerificationClaim?

    enum CodingKeys: String, CodingKey {
        case iss, sub, aud, exp, iat, nonce
        case authTime = "auth_time"
        case ageVerification = "age_verification"
    }
}

struct AgeVerificationClaim: Codable {
    let over18: Bool
    let verifiedAt: Int
    let method: String

    enum CodingKeys: String, CodingKey {
        case over18 = "over_18"
        case verifiedAt = "verified_at"
        case method
    }
}

// MARK: - Token Response

struct TokenResponse: Codable {
    let accessToken: String
    let tokenType: String
    let expiresIn: Int
    let idToken: String
    let scope: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case idToken = "id_token"
        case scope
    }
}

// MARK: - Internal Types

private struct AuthorizationCodeEntry {
    let code: String
    let clientId: String
    let redirectUri: String
    let scopes: [OIDCScope]
    let nonce: String
    let createdAt: Date
    let expiresAt: Date
    let codeChallenge: String?
    let codeChallengeMethod: String?
}

private struct AccessTokenEntry {
    let clientId: String
    let scopes: [OIDCScope]
    let createdAt: Date
    let expiresAt: Date
}

private struct TokenSubject {
    let did: String
    let verificationMethodId: String
    let issuer: String
    let signingKey: BiometricSigningKey
}

struct AccessTokenValidation {
    let clientId: String
    let scopes: [OIDCScope]
    let expiresAt: Date
}

// MARK: - Errors

enum OIDCTokenError: LocalizedError {
    case invalidCode
    case codeExpired
    case clientMismatch
    case redirectMismatch
    case encodingError
    case keyCreationFailed
    case signingFailed
    case pkceRequired
    case pkceFailed

    var errorDescription: String? {
        switch self {
        case .invalidCode: return "Invalid authorization code"
        case .codeExpired: return "Authorization code has expired"
        case .clientMismatch: return "Client ID mismatch"
        case .redirectMismatch: return "Redirect URI mismatch"
        case .encodingError: return "Token encoding failed"
        case .keyCreationFailed: return "Failed to create signing key"
        case .signingFailed: return "Failed to sign token"
        case .pkceRequired: return "PKCE code_verifier is required"
        case .pkceFailed: return "PKCE verification failed"
        }
    }
}
