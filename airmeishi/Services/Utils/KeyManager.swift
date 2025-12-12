//
//  KeyManager.swift
//  airmeishi
//
//  Cryptographic key management for ZK-ready architecture
//

import Foundation
import CryptoKit
import Security

/// Manages cryptographic keys for ZK-proof system and domain verification
class KeyManager {
    static let shared = KeyManager()
    
    private let keychain = KeychainManager()
    private let keyTag = "com.kidneyweakx.airmeishi.keys"
    
    // Key identifiers
    private enum KeyIdentifier: String, CaseIterable {
        case masterKey = "master_key"
        case signingKey = "signing_key"
        case verificationKey = "verification_key"
        case domainKey = "domain_key"
        case proofKey = "proof_key"
        
        var keychainTag: String {
            return "com.kidneyweakx.airmeishi.keys.\(self.rawValue)"
        }
    }
    
    private init() {}
    
    // MARK: - Public Methods
    
    /// Initialize key management system
    func initializeKeys() -> CardResult<Void> {
        // Generate master key if it doesn't exist
        let masterKeyResult = getOrCreateMasterKey()
        guard case .success = masterKeyResult else {
            return .failure(.encryptionError("Failed to initialize master key"))
        }
        
        // Generate signing key pair if it doesn't exist
        let signingKeyResult = getOrCreateSigningKeyPair()
        guard case .success = signingKeyResult else {
            return .failure(.encryptionError("Failed to initialize signing keys"))
        }
        
        // Generate domain verification key if it doesn't exist
        let domainKeyResult = getOrCreateDomainKey()
        guard case .success = domainKeyResult else {
            return .failure(.encryptionError("Failed to initialize domain key"))
        }
        
        return .success(())
    }
    
    /// Get master key for general encryption
    func getMasterKey() -> CardResult<SymmetricKey> {
        return getOrCreateMasterKey()
    }
    
    /// Get signing key pair for digital signatures
    func getSigningKeyPair() -> CardResult<(privateKey: P256.Signing.PrivateKey, publicKey: P256.Signing.PublicKey)> {
        return getOrCreateSigningKeyPair()
    }
    
    /// Get domain verification key
    func getDomainKey() -> CardResult<SymmetricKey> {
        return getOrCreateDomainKey()
    }
    
    /// Generate ephemeral key for one-time use
    func generateEphemeralKey() -> SymmetricKey {
        return SymmetricKey(size: .bits256)
    }
    
    /// Generate key derivation for specific purpose
    func deriveKey(from masterKey: SymmetricKey, purpose: String, context: String) -> CardResult<SymmetricKey> {
        let info = "\(purpose):\(context)".data(using: .utf8) ?? Data()
        
        let derivedKey = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: masterKey,
            info: info,
            outputByteCount: 32
        )
        return .success(derivedKey)
    }
    
    /// Rotate all keys (for security maintenance)
    func rotateKeys() -> CardResult<Void> {
        // Delete existing keys
        for keyId in KeyIdentifier.allCases {
            _ = keychain.deleteKey(tag: keyId.keychainTag)
        }
        
        // Reinitialize with new keys
        return initializeKeys()
    }
    
    /// Export public keys for sharing
    func exportPublicKeys() -> CardResult<PublicKeyBundle> {
        let signingKeyResult = getSigningKeyPair()
        
        switch signingKeyResult {
        case .success(let keyPair):
            let publicKeyData = keyPair.publicKey.rawRepresentation
            
            return .success(PublicKeyBundle(
                signingPublicKey: publicKeyData,
                keyId: UUID().uuidString,
                createdAt: Date(),
                expiresAt: Calendar.current.date(byAdding: .year, value: 1, to: Date()) ?? Date()
            ))
            
        case .failure(let error):
            return .failure(error)
        }
    }
    
    /// Verify a public key bundle
    func verifyPublicKeyBundle(_ bundle: PublicKeyBundle) -> CardResult<Bool> {
        // Check expiration
        if bundle.expiresAt < Date() {
            return .success(false)
        }
        
        // Verify key format
        do {
            _ = try P256.Signing.PublicKey(rawRepresentation: bundle.signingPublicKey)
            return .success(true)
        } catch {
            return .success(false)
        }
    }
    
    /// Clear all keys (for app reset)
    func clearAllKeys() -> CardResult<Void> {
        var hasError = false
        
        for keyId in KeyIdentifier.allCases {
            let result = keychain.deleteKey(tag: keyId.keychainTag)
            if case .failure = result {
                hasError = true
            }
        }
        
        return hasError ? .failure(.encryptionError("Failed to clear some keys")) : .success(())
    }
    
    // MARK: - Private Methods
    
    private func getOrCreateMasterKey() -> CardResult<SymmetricKey> {
        let tag = KeyIdentifier.masterKey.keychainTag
        
        // Try to retrieve existing key
        let retrieveResult = keychain.retrieveSymmetricKey(tag: tag)
        
        switch retrieveResult {
        case .success(let key):
            return .success(key)
            
        case .failure:
            // Generate new key
            let newKey = SymmetricKey(size: .bits256)
            let storeResult = keychain.storeSymmetricKey(newKey, tag: tag)
            
            switch storeResult {
            case .success:
                return .success(newKey)
            case .failure(let error):
                return .failure(error)
            }
        }
    }
    
    private func getOrCreateSigningKeyPair() -> CardResult<(privateKey: P256.Signing.PrivateKey, publicKey: P256.Signing.PublicKey)> {
        let tag = KeyIdentifier.signingKey.keychainTag
        
        // Try to retrieve existing key
        let retrieveResult = keychain.retrievePrivateKey(tag: tag)
        
        switch retrieveResult {
        case .success(let privateKey):
            return .success((privateKey: privateKey, publicKey: privateKey.publicKey))
            
        case .failure:
            // Generate new key pair
            let newPrivateKey = P256.Signing.PrivateKey()
            let storeResult = keychain.storePrivateKey(newPrivateKey, tag: tag)
            
            switch storeResult {
            case .success:
                return .success((privateKey: newPrivateKey, publicKey: newPrivateKey.publicKey))
            case .failure(let error):
                return .failure(error)
            }
        }
    }
    
    private func getOrCreateDomainKey() -> CardResult<SymmetricKey> {
        let tag = KeyIdentifier.domainKey.keychainTag
        
        // Try to retrieve existing key
        let retrieveResult = keychain.retrieveSymmetricKey(tag: tag)
        
        switch retrieveResult {
        case .success(let key):
            return .success(key)
            
        case .failure:
            // Generate new key
            let newKey = SymmetricKey(size: .bits256)
            let storeResult = keychain.storeSymmetricKey(newKey, tag: tag)
            
            switch storeResult {
            case .success:
                return .success(newKey)
            case .failure(let error):
                return .failure(error)
            }
        }
    }
}

// MARK: - Supporting Types

struct PublicKeyBundle: Codable {
    let signingPublicKey: Data
    let keyId: String
    let createdAt: Date
    let expiresAt: Date
    
    var isExpired: Bool {
        return expiresAt < Date()
    }
    
    var isValid: Bool {
        return !isExpired && signingPublicKey.count == 64 // P256 public key size
    }
}

// MARK: - Keychain Manager

private class KeychainManager {
    
    func storeSymmetricKey(_ key: SymmetricKey, tag: String) -> CardResult<Void> {
        let keyData = key.withUnsafeBytes { Data($0) }
        
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: tag,
            kSecValueData as String: keyData,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        
        // Delete existing key first
        _ = deleteKey(tag: tag)
        
        let status = SecItemAdd(query as CFDictionary, nil)
        
        if status == errSecSuccess {
            return .success(())
        } else {
            return .failure(.encryptionError("Failed to store symmetric key: \(status)"))
        }
    }
    
    func retrieveSymmetricKey(tag: String) -> CardResult<SymmetricKey> {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: tag,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        if status == errSecSuccess, let keyData = result as? Data {
            let key = SymmetricKey(data: keyData)
            return .success(key)
        } else {
            return .failure(.encryptionError("Failed to retrieve symmetric key: \(status)"))
        }
    }
    
    func storePrivateKey(_ key: P256.Signing.PrivateKey, tag: String) -> CardResult<Void> {
        let keyData = key.rawRepresentation
        
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: tag,
            kSecValueData as String: keyData,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        
        // Delete existing key first
        _ = deleteKey(tag: tag)
        
        let status = SecItemAdd(query as CFDictionary, nil)
        
        if status == errSecSuccess {
            return .success(())
        } else {
            return .failure(.encryptionError("Failed to store private key: \(status)"))
        }
    }
    
    func retrievePrivateKey(tag: String) -> CardResult<P256.Signing.PrivateKey> {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: tag,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        if status == errSecSuccess, let keyData = result as? Data {
            do {
                let key = try P256.Signing.PrivateKey(rawRepresentation: keyData)
                return .success(key)
            } catch {
                return .failure(.encryptionError("Failed to reconstruct private key: \(error.localizedDescription)"))
            }
        } else {
            return .failure(.encryptionError("Failed to retrieve private key: \(status)"))
        }
    }
    
    func deleteKey(tag: String) -> CardResult<Void> {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: tag
        ]
        
        let status = SecItemDelete(query as CFDictionary)
        
        if status == errSecSuccess || status == errSecItemNotFound {
            return .success(())
        } else {
            return .failure(.encryptionError("Failed to delete key: \(status)"))
        }
    }
}
