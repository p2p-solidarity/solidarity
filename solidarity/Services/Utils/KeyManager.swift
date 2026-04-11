//
//
//  KeyManager.swift
//  solidarity
//
//  Cryptographic key management for ZK-ready architecture
//

import CryptoKit
import Foundation
import Security

class KeyManager {
  static let shared = KeyManager()

  let keychain = KeychainManager()

  enum KeyIdentifier: String, CaseIterable {
    case masterKey = "master_key"
    case signingKey = "signing_key"
    case verificationKey = "verification_key"
    case domainKey = "domain_key"
    case proofKey = "proof_key"

    var legacyKeychainTag: String {
      return "com.kidneyweakx.airmeishi.keys.\(self.rawValue)"
    }

    var primaryTag: String {
      switch self {
      case .masterKey:
        return "solidarity.symm.master"
      case .signingKey:
        return "solidarity.symm.signing"
      case .domainKey:
        return "solidarity.symm.domain"
      case .verificationKey:
        return "solidarity.symm.verification"
      case .proofKey:
        return "solidarity.symm.proof"
      }
    }

    /// Previous primaryTag values before the rename to solidarity.symm.* namespace.
    /// Used as migration fallbacks in readTags.
    var legacyPrimaryTags: [String] {
      switch self {
      case .masterKey:
        return ["solidarity.master"]
      case .signingKey:
        return ["solidarity.master.signing"]
      case .domainKey:
        return ["solidarity.rp.default"]
      case .verificationKey:
        return ["solidarity.master.verification"]
      case .proofKey:
        return ["solidarity.master.proof"]
      }
    }

    var readTags: [String] {
      let tags = [primaryTag] + legacyPrimaryTags + [legacyKeychainTag]
      return Array(NSOrderedSet(array: tags)) as? [String] ?? tags
    }

    var allTags: [String] {
      readTags  // includes primaryTag + legacyPrimaryTags + legacyKeychainTag
    }
  }

  private init() {}

  // MARK: - Public Methods

  func initializeKeys() -> CardResult<Void> {
    let masterKeyResult = getOrCreateMasterKey()
    guard case .success = masterKeyResult else {
      return .failure(.encryptionError("Failed to initialize master key"))
    }

    let signingKeyResult = getOrCreateSigningKeyPair()
    guard case .success = signingKeyResult else {
      return .failure(.encryptionError("Failed to initialize signing keys"))
    }

    let domainKeyResult = getOrCreateDomainKey()
    guard case .success = domainKeyResult else {
      return .failure(.encryptionError("Failed to initialize domain key"))
    }

    return .success(())
  }

  func getMasterKey() -> CardResult<SymmetricKey> {
    return getOrCreateMasterKey()
  }

  func getSigningKeyPair() -> CardResult<(privateKey: P256.Signing.PrivateKey, publicKey: P256.Signing.PublicKey)> {
    return getOrCreateSigningKeyPair()
  }

  func getDomainKey() -> CardResult<SymmetricKey> {
    return getOrCreateDomainKey()
  }

  func generateEphemeralKey() -> SymmetricKey {
    return SymmetricKey(size: .bits256)
  }

  func deriveKey(from masterKey: SymmetricKey, purpose: String, context: String) -> CardResult<SymmetricKey> {
    let info = Data("\(purpose):\(context)".utf8)

    let derivedKey = HKDF<SHA256>
      .deriveKey(
        inputKeyMaterial: masterKey,
        info: info,
        outputByteCount: 32
      )
    return .success(derivedKey)
  }

  func rotateKeys() -> CardResult<Void> {
    for keyId in KeyIdentifier.allCases {
      for tag in keyId.allTags {
        _ = keychain.deleteKey(tag: tag)
      }
    }

    return initializeKeys()
  }

  func exportPublicKeys() -> CardResult<PublicKeyBundle> {
    let signingKeyResult = getSigningKeyPair()

    switch signingKeyResult {
    case .success(let keyPair):
      let publicKeyData = keyPair.publicKey.rawRepresentation

      return .success(
        PublicKeyBundle(
          signingPublicKey: publicKeyData,
          keyId: UUID().uuidString,
          createdAt: Date(),
          expiresAt: Calendar.current.date(byAdding: .year, value: 1, to: Date()) ?? Date()
        )
      )

    case .failure(let error):
      return .failure(error)
    }
  }

  func verifyPublicKeyBundle(_ bundle: PublicKeyBundle) -> CardResult<Bool> {
    if bundle.expiresAt < Date() {
      return .success(false)
    }

    do {
      _ = try P256.Signing.PublicKey(rawRepresentation: bundle.signingPublicKey)
      return .success(true)
    } catch {
      return .success(false)
    }
  }

  func clearAllKeys() -> CardResult<Void> {
    var hasError = false

    for keyId in KeyIdentifier.allCases {
      for tag in keyId.allTags {
        let result = keychain.deleteKey(tag: tag)
        if case .failure = result {
          hasError = true
        }
      }
    }

    return hasError ? .failure(.encryptionError("Failed to clear some keys")) : .success(())
  }

  // MARK: - Private Methods

  private func getOrCreateMasterKey() -> CardResult<SymmetricKey> {
    let identifier = KeyIdentifier.masterKey
    let retrieveResult = retrieveSymmetricKey(identifier)

    switch retrieveResult {
    case .success(let key):
      return .success(key)

    case .failure:
      let newKey = SymmetricKey(size: .bits256)
      let storeResult = storeSymmetricKey(newKey, identifier: identifier)

      switch storeResult {
      case .success:
        return .success(newKey)
      case .failure(let error):
        return .failure(error)
      }
    }
  }

  private func getOrCreateSigningKeyPair() -> CardResult<
    (privateKey: P256.Signing.PrivateKey, publicKey: P256.Signing.PublicKey)
  > {
    let identifier = KeyIdentifier.signingKey
    let retrieveResult = retrievePrivateKey(identifier)

    switch retrieveResult {
    case .success(let privateKey):
      return .success((privateKey: privateKey, publicKey: privateKey.publicKey))

    case .failure:
      let newPrivateKey = P256.Signing.PrivateKey()
      let storeResult = storePrivateKey(newPrivateKey, identifier: identifier)

      switch storeResult {
      case .success:
        return .success((privateKey: newPrivateKey, publicKey: newPrivateKey.publicKey))
      case .failure(let error):
        return .failure(error)
      }
    }
  }

  private func getOrCreateDomainKey() -> CardResult<SymmetricKey> {
    let identifier = KeyIdentifier.domainKey
    let retrieveResult = retrieveSymmetricKey(identifier)

    switch retrieveResult {
    case .success(let key):
      return .success(key)

    case .failure:
      let newKey = SymmetricKey(size: .bits256)
      let storeResult = storeSymmetricKey(newKey, identifier: identifier)

      switch storeResult {
      case .success:
        return .success(newKey)
      case .failure(let error):
        return .failure(error)
      }
    }
  }

}
