//
//  OIDCTokenService.swift
//  airmeishi
//
//  JWT token generation and validation for OIDC flows
//  Uses DID private key for signing
//

import Foundation
import CryptoKit
import UIKit

// MARK: - OIDC Token Service

final class OIDCTokenService {
    static let shared = OIDCTokenService()

    private let issuer = "solidarity-vault"
    private let tokenExpiry: TimeInterval = 3600 // 1 hour
    private let codeExpiry: TimeInterval = 600   // 10 minutes

    private var authorizationCodes: [String: AuthorizationCodeEntry] = [:]
    private var accessTokens: [String: AccessTokenEntry] = [:]

    private init() {
        // Clean up expired codes periodically
        Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.cleanupExpiredTokens()
        }
    }

    // MARK: - Authorization Code

    /// Generate an authorization code for approved request
    func generateAuthorizationCode(
        for request: OIDCAuthorizationRequest,
        grantedScopes: [OIDCScope]
    ) -> String {
        // Generate PKCE-style code
        let randomBytes = (0..<32).map { _ in UInt8.random(in: 0...255) }
        let code = Data(randomBytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")

        let entry = AuthorizationCodeEntry(
            code: code,
            clientId: request.clientId,
            redirectUri: request.redirectUri,
            scopes: grantedScopes,
            nonce: request.nonce,
            createdAt: Date(),
            expiresAt: Date().addingTimeInterval(codeExpiry)
        )

        authorizationCodes[code] = entry
        return code
    }

    /// Exchange authorization code for tokens
    func exchangeCode(
        _ code: String,
        clientId: String,
        redirectUri: String,
        codeVerifier: String? = nil
    ) throws -> TokenResponse {
        guard let entry = authorizationCodes[code] else {
            throw OIDCTokenError.invalidCode
        }

        guard entry.expiresAt > Date() else {
            authorizationCodes.removeValue(forKey: code)
            throw OIDCTokenError.codeExpired
        }

        guard entry.clientId == clientId else {
            throw OIDCTokenError.clientMismatch
        }

        guard entry.redirectUri == redirectUri else {
            throw OIDCTokenError.redirectMismatch
        }

        // Invalidate the code (one-time use)
        authorizationCodes.removeValue(forKey: code)

        // Generate tokens
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
        accessTokens.removeValue(forKey: token)
    }

    // MARK: - JWT Generation

    /// Generate a signed access token
    private func generateAccessToken(
        clientId: String,
        scopes: [OIDCScope],
        nonce: String
    ) throws -> String {
        let now = Date()
        let exp = now.addingTimeInterval(tokenExpiry)

        let payload = AccessTokenPayload(
            iss: issuer,
            sub: currentSubject(),
            aud: clientId,
            exp: Int(exp.timeIntervalSince1970),
            iat: Int(now.timeIntervalSince1970),
            jti: UUID().uuidString,
            scope: scopes.map { $0.rawValue }.joined(separator: " ")
        )

        let token = try signJWT(payload: payload)

        // Store for validation
        accessTokens[token] = AccessTokenEntry(
            clientId: clientId,
            scopes: scopes,
            createdAt: now,
            expiresAt: exp
        )

        return token
    }

    /// Generate a signed ID token
    private func generateIDToken(
        clientId: String,
        scopes: [OIDCScope],
        nonce: String
    ) throws -> String {
        let now = Date()
        let exp = now.addingTimeInterval(tokenExpiry)

        var claims = IDTokenClaims(
            iss: issuer,
            sub: currentSubject(),
            aud: clientId,
            exp: Int(exp.timeIntervalSince1970),
            iat: Int(now.timeIntervalSince1970),
            nonce: nonce,
            authTime: Int(now.timeIntervalSince1970)
        )

        // Add scope-specific claims
        if scopes.contains(.ageOver18) {
            claims.ageVerification = AgeVerificationClaim(
                over18: true,
                verifiedAt: Int(now.timeIntervalSince1970),
                method: "self_declared"
            )
        }

        return try signJWT(payload: claims)
    }

    /// Sign a JWT payload
    private func signJWT<T: Encodable>(payload: T) throws -> String {
        let header = OIDCJWTHeader(alg: "ES256", typ: "JWT")

        let headerData = try JSONEncoder().encode(header)
        let payloadData = try JSONEncoder().encode(payload)

        let headerB64 = base64URLEncode(headerData)
        let payloadB64 = base64URLEncode(payloadData)

        let signingInput = "\(headerB64).\(payloadB64)"

        // Sign using the vault's signing key
        let signature = try sign(signingInput)
        let signatureB64 = base64URLEncode(signature)

        return "\(signingInput).\(signatureB64)"
    }

    /// Sign data using P-256 key from Keychain
    private func sign(_ input: String) throws -> Data {
        guard let inputData = input.data(using: .utf8) else {
            throw OIDCTokenError.encodingError
        }

        let privateKey = try getOrCreateSigningKey()
        let signature = try privateKey.signature(for: inputData)

        return signature.rawRepresentation
    }

    /// Get or create the signing key
    private func getOrCreateSigningKey() throws -> P256.Signing.PrivateKey {
        let tag = "com.solidarity.oidc.signing.key"

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "solidarity-oidc",
            kSecAttrAccount as String: tag,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecSuccess, let keyData = result as? Data {
            return try P256.Signing.PrivateKey(rawRepresentation: keyData)
        }

        // Create new key
        let newKey = P256.Signing.PrivateKey()
        let keyData = newKey.rawRepresentation

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "solidarity-oidc",
            kSecAttrAccount as String: tag,
            kSecValueData as String: keyData,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw OIDCTokenError.keyCreationFailed
        }

        return newKey
    }

    /// Get current subject (user's DID or device ID)
    private func currentSubject() -> String {
        // In production, this would return the user's DID
        // For now, use a device-specific identifier
        if let deviceId = UIDevice.current.identifierForVendor?.uuidString {
            return "did:solidarity:\(deviceId)"
        }
        return "did:solidarity:unknown"
    }

    /// Base64URL encode
    private func base64URLEncode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// Cleanup expired tokens
    private func cleanupExpiredTokens() {
        let now = Date()
        authorizationCodes = authorizationCodes.filter { $0.value.expiresAt > now }
        accessTokens = accessTokens.filter { $0.value.expiresAt > now }
    }
}

// MARK: - JWT Types

private struct OIDCJWTHeader: Codable {
    let alg: String
    let typ: String
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
}

private struct AccessTokenEntry {
    let clientId: String
    let scopes: [OIDCScope]
    let createdAt: Date
    let expiresAt: Date
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

    var errorDescription: String? {
        switch self {
        case .invalidCode: return "Invalid authorization code"
        case .codeExpired: return "Authorization code has expired"
        case .clientMismatch: return "Client ID mismatch"
        case .redirectMismatch: return "Redirect URI mismatch"
        case .encodingError: return "Token encoding failed"
        case .keyCreationFailed: return "Failed to create signing key"
        case .signingFailed: return "Failed to sign token"
        }
    }
}
