//
//  SemaphoreIdentityManager.swift
//  airmeishi
//
//  Manages Semaphore identity lifecycle, commitments, and proof helpers.
//  Uses Keychain to store the private identity secret locally.
//

import Foundation
import CryptoKit

#if canImport(Semaphore)
import Semaphore
#endif

/// Stores and manages Semaphore identity material. All identity secrets stay local.
final class SemaphoreIdentityManager: ObservableObject {
    static let shared = SemaphoreIdentityManager()

    private init() {}

    private let keychain = IdentityKeychain()

    // Whether the SemaphoreSwift library is available for proof ops
    static var proofsSupported: Bool {
        #if canImport(Semaphore)
        return true
        #else
        return false
        #endif
    }

    struct IdentityBundle: Codable, Equatable {
        let privateKey: Data        // trapdoor + nullifier source (as used by SemaphoreSwift)
        let commitment: String      // public commitment hex/string
    }

    enum Error: Swift.Error { case notInitialized, storageFailed(String), unsupported }

    // MARK: - Identity

    /// Load existing identity or create a new one with random secret.
    func loadOrCreateIdentity() throws -> IdentityBundle {
        if let existing = try? keychain.loadIdentity() {
            let fixed = ensureCommitment(bundle: existing)
            if fixed.commitment != existing.commitment {
                try? keychain.storeIdentity(fixed)
                ZKLog.info("Migrated empty commitment → prefix: \(fixed.commitment.prefix(8))")
            } else {
                ZKLog.info("Loaded existing identity with commitment prefix: \(existing.commitment.prefix(8))")
            }
            return fixed
        }

        let secret = randomSecret32()

        #if canImport(Semaphore)
        let identity = Identity(privateKey: secret)
        let commitment = identity.commitment()
        let bundle = IdentityBundle(privateKey: secret, commitment: commitment)
        try keychain.storeIdentity(bundle)
        ZKLog.info("Created identity (semaphore). commitment prefix: \(commitment.prefix(8))")
        return bundle
        #else
        let bundle = IdentityBundle(privateKey: secret, commitment: fallbackCommitment(from: secret))
        try keychain.storeIdentity(bundle)
        ZKLog.info("Created identity (fallback). commitment prefix: \(bundle.commitment.prefix(8))")
        return bundle
        #endif
    }

    /// Returns current identity bundle if present.
    func getIdentity() -> IdentityBundle? {
        guard let loaded = try? keychain.loadIdentity() else { return nil }
        let fixed = ensureCommitment(bundle: loaded)
        if fixed.commitment != loaded.commitment { try? keychain.storeIdentity(fixed) }
        return fixed
    }

    /// Replaces identity with provided secret bytes.
    func importIdentity(privateKey: Data) throws -> IdentityBundle {
        #if canImport(Semaphore)
        let identity = Identity(privateKey: privateKey)
        let commitment = identity.commitment()
        let bundle = IdentityBundle(privateKey: privateKey, commitment: commitment)
        try keychain.storeIdentity(bundle)
        ZKLog.info("Imported identity (semaphore). commitment prefix: \(commitment.prefix(8))")
        return bundle
        #else
        let bundle = IdentityBundle(privateKey: privateKey, commitment: fallbackCommitment(from: privateKey))
        try keychain.storeIdentity(bundle)
        ZKLog.info("Imported identity (fallback). commitment prefix: \(bundle.commitment.prefix(8))")
        return bundle
        #endif
    }

    // MARK: - Proof helpers

    /// Generate a Semaphore proof JSON string for a message/scope within a group.
    /// Group members should be provided as commitments (hex/strings) including own commitment.
    func generateProof(groupCommitments: [String], message: String, scope: String, merkleDepth: Int = 16) throws -> String {
        #if canImport(Semaphore)
        guard let bundle = try? keychain.loadIdentity() else { throw Error.notInitialized }
        let identity = Identity(privateKey: bundle.privateKey)
        // Build a minimal group that at least contains our own identity element.
        // TODO: When available, convert external commitment strings to elements and include them.
        let group = Group(members: [identity.toElement()])
        // The bindings expect arbitrary strings that are internally converted to field elements.
        // Avoid passing 64-char hex (which exceeds 32 bytes) — clamp to 32 UTF-8 bytes if needed.
        let normalizedMessage = Self.clampToMax32Bytes(message)
        let normalizedScope = Self.clampToMax32Bytes(scope)
        return try generateSemaphoreProof(
            identity: identity,
            group: group,
            message: normalizedMessage,
            scope: normalizedScope,
            merkleTreeDepth: UInt16(merkleDepth)
        )
        #else
        throw Error.unsupported
        #endif
    }

    /// Verify a Semaphore proof JSON string.
    func verifyProof(_ proof: String) throws -> Bool {
        #if canImport(Semaphore)
        return try verifySemaphoreProof(proof: proof)
        #else
        return false
        #endif
    }

    // MARK: - Utilities

    private func randomSecret32() -> Data {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes)
    }

    /// Fallback commitment when Semaphore library is not present: SHA256 of secret bytes (hex)
    private func fallbackCommitment(from secret: Data) -> String {
        let digest = SHA256.hash(data: secret)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private static func clampToMax32Bytes(_ input: String) -> String {
        let bytes = Array(input.utf8)
        if bytes.count <= 32 { return input }
        return String(decoding: bytes.prefix(32), as: UTF8.self)
    }

    private func ensureCommitment(bundle: IdentityBundle) -> IdentityBundle {
        guard bundle.commitment.isEmpty else { return bundle }
        #if canImport(Semaphore)
        let identity = Identity(privateKey: bundle.privateKey)
        let commitment = identity.commitment()
        return IdentityBundle(privateKey: bundle.privateKey, commitment: commitment)
        #else
        return IdentityBundle(privateKey: bundle.privateKey, commitment: fallbackCommitment(from: bundle.privateKey))
        #endif
    }
}

// MARK: - Keychain storage for identity

private final class IdentityKeychain {
    private let tag = "com.kidneyweakx.airmeishi.semaphore.identity"

    func storeIdentity(_ bundle: SemaphoreIdentityManager.IdentityBundle) throws {
        let data = try JSONEncoder().encode(bundle)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: tag,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw SemaphoreIdentityManager.Error.storageFailed("SecItemAdd: \(status)") }
    }

    func loadIdentity() throws -> SemaphoreIdentityManager.IdentityBundle? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: tag,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw SemaphoreIdentityManager.Error.storageFailed("SecItemCopyMatching: \(status)") }
        return try JSONDecoder().decode(SemaphoreIdentityManager.IdentityBundle.self, from: data)
    }
}
