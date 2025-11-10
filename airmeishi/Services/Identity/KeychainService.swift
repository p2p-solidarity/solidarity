//
//  KeychainService.swift
//  airmeishi
//
//  Secure storage and retrieval of DID signing keys backed by iOS Keychain with biometric access control.
//

import Foundation
import LocalAuthentication
import Security
import CryptoKit
import SpruceIDMobileSdkRs

/// Manages the DID signing key material using the system Keychain.
final class KeychainService {
    static let shared = KeychainService()

    let alias: KeyAlias

    private let keyTag: Data
    private let accessControlFlags: SecAccessControlCreateFlags
    private let accessPrompt: String
    private let authenticationPolicy: LAPolicy

    init(
        alias: KeyAlias = "airmeishi.did.signing",
        accessControlFlags: SecAccessControlCreateFlags = [.biometryCurrentSet, .privateKeyUsage],
        accessPrompt: String = "Authenticate to access your AirMeishi identity key",
        authenticationPolicy: LAPolicy = .deviceOwnerAuthentication
    ) {
        self.alias = alias
        self.keyTag = Data(alias.utf8)
        self.accessControlFlags = accessControlFlags
        self.accessPrompt = accessPrompt
        self.authenticationPolicy = authenticationPolicy
    }

    // MARK: - Public API

    /// Ensures the signing key exists, generating it if needed.
    func ensureSigningKey() -> CardResult<Void> {
        if keyExists() {
            return .success(())
        }

        switch generateSigningKey(useSecureEnclave: true) {
        case .success:
            return .success(())
        case .failure(let firstError):
            // Attempt to fall back to software-based key generation if Secure Enclave is unavailable.
            switch generateSigningKey(useSecureEnclave: false) {
            case .success:
                return .success(())
            case .failure(let fallbackError):
                return .failure(combine(firstError, fallbackError))
            }
        }
    }

    /// Retrieves a signing key conforming to SpruceKit's requirements.
    func signingKey(context: LAContext? = nil) -> CardResult<BiometricSigningKey> {
        switch ensureSigningKey() {
        case .failure(let error):
            return .failure(error)
        case .success:
            break
        }

        switch privateKey(context: context) {
        case .failure(let error):
            return .failure(error)
        case .success(let key):
            switch jwk(for: key) {
            case .failure(let error):
                return .failure(error)
            case .success(let jwk):
                return .success(BiometricSigningKey(privateKey: key, jwk: jwk, alias: alias))
            }
        }
    }

    /// Returns the public JWK representation of the signing key.
    func publicJwk(context: LAContext? = nil) -> CardResult<PublicKeyJWK> {
        switch ensureSigningKey() {
        case .failure(let error):
            return .failure(error)
        case .success:
            break
        }

        switch privateKey(context: context) {
        case .failure(let error):
            return .failure(error)
        case .success(let key):
            return jwk(for: key)
        }
    }

    /// Returns the public JWK serialized to a JSON string.
    func publicJwkString(context: LAContext? = nil, prettyPrinted: Bool = false) -> CardResult<String> {
        switch publicJwk(context: context) {
        case .failure(let error):
            return .failure(error)
        case .success(let jwk):
            do {
                return .success(try jwk.jsonString(prettyPrinted: prettyPrinted))
            } catch {
                return .failure(.keyManagementError("Failed to encode JWK: \(error.localizedDescription)"))
            }
        }
    }

    /// Creates an authentication context ready for Keychain access.
    func authenticationContext(reason: String? = nil) -> CardResult<LAContext> {
        let context = LAContext()
        context.localizedCancelTitle = "Cancel"
        context.localizedFallbackTitle = "Use Passcode"

        var evaluationError: NSError?
        guard context.canEvaluatePolicy(authenticationPolicy, error: &evaluationError) else {
            let message = evaluationError?.localizedDescription ?? "Biometric authentication unavailable"
            return .failure(.keyManagementError(message))
        }

        if let reason = reason {
            context.touchIDAuthenticationAllowableReuseDuration = 5
            context.setLocalizedReason(reason)
        }

        return .success(context)
    }

    /// Deletes the signing key from the Keychain.
    func deleteSigningKey() -> CardResult<Void> {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: keyTag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom
        ]

        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            return .success(())
        } else {
            return .failure(.keyManagementError("Failed to delete signing key: \(statusDescription(status))"))
        }
    }

    // MARK: - Private helpers

    private func keyExists() -> Bool {
        let context = LAContext()
        context.interactionNotAllowed = true

        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: keyTag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true,
            kSecUseAuthenticationContext as String: context
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        switch status {
        case errSecSuccess,
             errSecInteractionNotAllowed,
             errSecAuthFailed:
            return true
        case errSecItemNotFound:
            return false
        default:
            return false
        }
    }

    private func generateSigningKey(useSecureEnclave: Bool) -> CardResult<Void> {
        guard let accessControl = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            accessControlFlags,
            nil
        ) else {
            return .failure(.keyManagementError("Failed to configure key access control"))
        }

        var attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrIsPermanent as String: true,
            kSecAttrAccessControl as String: accessControl,
            kSecAttrApplicationTag as String: keyTag
        ]

        if useSecureEnclave {
            attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
        }

        var error: Unmanaged<CFError>?
        guard SecKeyCreateRandomKey(attributes as CFDictionary, &error) != nil else {
            let cfError = error?.takeRetainedValue()
            let message = (cfError as Error?)?.localizedDescription
                ?? "Unknown error (\(statusDescription(errSecParam)))"
            return .failure(.keyManagementError("Failed to generate signing key: \(message)"))
        }

        return .success(())
    }

    private func privateKey(context: LAContext?) -> CardResult<SecKey> {
        var query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: keyTag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true
        ]

        let authContext: LAContext
        if let context = context {
            authContext = context
        } else {
            let newContext = LAContext()
            newContext.touchIDAuthenticationAllowableReuseDuration = 5
            newContext.localizedFallbackTitle = "Use Passcode"
            authContext = newContext
        }

        query[kSecUseAuthenticationContext as String] = authContext

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        guard status == errSecSuccess else {
            return .failure(.keyManagementError("Failed to retrieve signing key: \(statusDescription(status))"))
        }

        let key = item as! SecKey
        return .success(key)
    }

    private func jwk(for privateKey: SecKey) -> CardResult<PublicKeyJWK> {
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            return .failure(.keyManagementError("Failed to derive public key from signing key"))
        }

        var error: Unmanaged<CFError>?
        guard let data = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
            let cfError = error?.takeRetainedValue()
            let message = (cfError as Error?)?.localizedDescription
                ?? "Unknown error exporting public key"
            return .failure(.keyManagementError(message))
        }

        guard data.count == 65 else {
            return .failure(.keyManagementError("Unexpected public key length: \(data.count) bytes"))
        }

        let x = data.subdata(in: 1..<33)
        let y = data.subdata(in: 33..<65)
        let jwk = PublicKeyJWK(
            kty: "EC",
            crv: "P-256",
            alg: "ES256",
            x: x.base64URLEncodedString(),
            y: y.base64URLEncodedString()
        )
        return .success(jwk)
    }

    private func combine(_ first: CardError, _ second: CardError) -> CardError {
        switch (first, second) {
        case (.keyManagementError(let a), .keyManagementError(let b)):
            return .keyManagementError("\(a); \(b)")
        default:
            return second
        }
    }

    private func statusDescription(_ status: OSStatus) -> String {
        if let message = SecCopyErrorMessageString(status, nil) as String? {
            return message
        }
        return "OSStatus \(status)"
    }
}

// MARK: - Signing key wrapper

/// Signing key implementation compatible with SpruceKit.
final class BiometricSigningKey: SpruceIDMobileSdkRs.SigningKey, @unchecked Sendable {
    private let privateKey: SecKey
    private let jwkRepresentation: PublicKeyJWK
    private let alias: KeyAlias

    init(privateKey: SecKey, jwk: PublicKeyJWK, alias: KeyAlias) {
        self.privateKey = privateKey
        self.jwkRepresentation = jwk
        self.alias = alias
    }

    func jwk() throws -> String {
        return try jwkRepresentation.jsonString()
    }

    func sign(payload: Data) throws -> Data {
        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(
            privateKey,
            .ecdsaSignatureMessageX962SHA256,
            payload as CFData,
            &error
        ) as Data? else {
            let cfError = error?.takeRetainedValue()
            let message = (cfError as Error?)?.localizedDescription ?? "Unknown signing error"
            throw CardError.keyManagementError("Failed to sign payload: \(message)")
        }

        guard let normalized = CryptoCurveUtils.secp256r1().ensureRawFixedWidthSignatureEncoding(bytes: signature) else {
            throw CardError.keyManagementError("Unable to normalise signature for alias \(alias)")
        }

        return normalized
    }
}

// MARK: - Supporting models

/// Minimal JSON Web Key representation for EC P-256 keys.
struct PublicKeyJWK: Codable, Equatable {
    let kty: String
    let crv: String
    let alg: String
    let x: String
    let y: String

    func jsonData(prettyPrinted: Bool = false) throws -> Data {
        let encoder = JSONEncoder()
        if prettyPrinted {
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        } else {
            encoder.outputFormatting = [.sortedKeys]
        }
        return try encoder.encode(self)
    }

    func jsonString(prettyPrinted: Bool = false) throws -> String {
        let data = try jsonData(prettyPrinted: prettyPrinted)
        guard let string = String(data: data, encoding: .utf8) else {
            throw CardError.keyManagementError("Unable to encode JWK string")
        }
        return string
    }

    func x963Representation() throws -> Data {
        guard let xData = Data(base64URLEncoded: x),
              let yData = Data(base64URLEncoded: y)
        else {
            throw CardError.invalidData("Invalid public key encoding")
        }

        var buffer = Data([0x04])
        buffer.append(xData)
        buffer.append(yData)
        return buffer
    }

    func toP256PublicKey() throws -> P256.Signing.PublicKey {
        let data = try x963Representation()
        return try P256.Signing.PublicKey(x963Representation: data)
    }
}

// MARK: - LAContext helpers

private extension LAContext {
    func setLocalizedReason(_ reason: String) {
        // The localized reason is provided when the system prompt is displayed via Keychain.
        // There is no direct API to set it on the context, so we rely on the Keychain prompt instead.
        // This method exists to make call sites more expressive.
    }
}

