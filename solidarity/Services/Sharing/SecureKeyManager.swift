import CryptoKit
import Foundation
import Security

class SecureKeyManager {
  static let shared = SecureKeyManager()

  // Stored in Keychain (Simplified version, error handling recommended for production)
  private var signingKey: Curve25519.Signing.PrivateKey!
  private var encryptionKey: Curve25519.KeyAgreement.PrivateKey!

  // Locally stored sealed_route
  var mySealedRoute: String? {
    get { UserDefaults.standard.string(forKey: "mySealedRoute") }
    set { UserDefaults.standard.set(newValue, forKey: "mySealedRoute") }
  }

  init() {
    loadOrGenerateKeys()
  }

  private static let signingService = "solidarity.messaging.signing"
  private static let encryptionService = "solidarity.messaging.encryption"
  private static let account = "default"

  private func loadOrGenerateKeys() {
    if let sigData = Self.loadFromKeychain(service: Self.signingService),
       let encData = Self.loadFromKeychain(service: Self.encryptionService),
       let sig = try? Curve25519.Signing.PrivateKey(rawRepresentation: sigData),
       let enc = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: encData) {
      self.signingKey = sig
      self.encryptionKey = enc
      return
    }
    // Generate and persist new keys
    let newSigning = Curve25519.Signing.PrivateKey()
    let newEncryption = Curve25519.KeyAgreement.PrivateKey()
    Self.saveToKeychain(data: newSigning.rawRepresentation, service: Self.signingService)
    Self.saveToKeychain(data: newEncryption.rawRepresentation, service: Self.encryptionService)
    self.signingKey = newSigning
    self.encryptionKey = newEncryption
  }

  private static func loadFromKeychain(service: String) -> Data? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess else { return nil }
    return result as? Data
  }

  private static func saveToKeychain(data: Data, service: String) {
    // Delete any existing item first
    let deleteQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(deleteQuery as CFDictionary)

    let addQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
    ]
    SecItemAdd(addQuery as CFDictionary, nil)
  }

  // Get my public key (Base64 String)
  var mySignPubKey: String {
    signingKey.publicKey.rawRepresentation.base64EncodedString()
  }

  var myEncPubKey: String {
    encryptionKey.publicKey.rawRepresentation.base64EncodedString()
  }

  // --- Feature A: Signing (For API verification) ---
  func sign(content: String) -> String {
    guard let data = content.data(using: .utf8) else { return "" }
    if let signature = try? signingKey.signature(for: data) {
      return signature.base64EncodedString()
    }
    return ""
  }

  // Debug: Verify signature locally
  func verify(signatureBase64: String, content: String, pubKeyBase64: String) -> Bool {
    guard let sigData = Data(base64Encoded: signatureBase64),
      let contentData = content.data(using: .utf8),
      let pubKeyData = Data(base64Encoded: pubKeyBase64),
      let pubKey = try? Curve25519.Signing.PublicKey(rawRepresentation: pubKeyData)
    else {
      print("[SecureKeyManager] Verify failed: Invalid data/key")
      return false
    }

    return pubKey.isValidSignature(sigData, for: contentData)
  }

  // Envelope versioning for backward-compatible decrypt.
  // v1 = legacy ChaChaPoly.combined (no salt prepended, HKDF salt = Data()).
  // v2 = [0x02 | 32-byte salt | ChaChaPoly.combined], HKDF salt = random per message.
  private static let envelopeVersionV2: UInt8 = 0x02
  private static let v2SaltByteCount = 32
  private static let messageSharedInfo: Data = Data("solidarity.secureMessage.v2".utf8)

  // --- Feature B: Encrypt Message (Send Mail) ---
  // Uses NaCl Box concept (ECDH + ChaCha20Poly1305)
  func encrypt(message: String, for recipientPubKeyBase64: String) throws -> String {
    print("[SecureKeyManager] Encrypting for recipient: \(recipientPubKeyBase64)")

    guard let recipientData = Data(base64Encoded: recipientPubKeyBase64) else {
      print("[SecureKeyManager] Failed to decode base64 key")
      throw NSError(domain: "Crypto", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid Base64 Key"])
    }

    guard let recipientKey = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: recipientData) else {
      print("[SecureKeyManager] Failed to create PublicKey from data (count: \(recipientData.count))")
      throw NSError(domain: "Crypto", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid Curve25519 Key"])
    }

    // 1. Establish Shared Secret
    let sharedSecret = try encryptionKey.sharedSecretFromKeyAgreement(with: recipientKey)

    // 2. Generate fresh per-message salt and derive a unique key.
    //    Domain-separate via sharedInfo so any future protocol that reuses the
    //    same shared secret cannot collide with secure messages.
    let salt = Self.randomBytes(count: Self.v2SaltByteCount)
    let symmetricKey = sharedSecret.hkdfDerivedSymmetricKey(
      using: SHA256.self,
      salt: salt,
      sharedInfo: Self.messageSharedInfo,
      outputByteCount: 32
    )

    // 3. Encrypt
    guard let data = message.data(using: .utf8) else {
      throw NSError(
        domain: "Crypto",
        code: -1,
        userInfo: [NSLocalizedDescriptionKey: "Failed to encode message to UTF-8"]
      )
    }
    let sealedBox = try ChaChaPoly.seal(data, using: symmetricKey)

    // 4. Wrap in versioned envelope: [0x02][32-byte salt][nonce + ciphertext + tag]
    var envelope = Data()
    envelope.append(Self.envelopeVersionV2)
    envelope.append(salt)
    envelope.append(sealedBox.combined)

    return envelope.base64EncodedString()
  }

  // --- Feature C: Decrypt Message (Receive Mail) ---
  func decrypt(blobBase64: String, from senderPubKeyBase64: String) throws -> String {
    guard let combinedData = Data(base64Encoded: blobBase64),
      let senderData = Data(base64Encoded: senderPubKeyBase64),
      let senderKey = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: senderData)
    else {
      throw NSError(domain: "Crypto", code: -2, userInfo: [NSLocalizedDescriptionKey: "Decrypt Failed"])
    }

    let sharedSecret = try encryptionKey.sharedSecretFromKeyAgreement(with: senderKey)

    // Try v2 envelope first (fresh per-message salt + domain-separated sharedInfo).
    if combinedData.count > 1 + Self.v2SaltByteCount,
       combinedData[combinedData.startIndex] == Self.envelopeVersionV2 {
      let saltStart = combinedData.startIndex + 1
      let saltEnd = saltStart + Self.v2SaltByteCount
      let salt = combinedData.subdata(in: saltStart..<saltEnd)
      let payload = combinedData.subdata(in: saltEnd..<combinedData.endIndex)

      guard let sealedBox = try? ChaChaPoly.SealedBox(combined: payload) else {
        throw NSError(domain: "Crypto", code: -2, userInfo: [NSLocalizedDescriptionKey: "Decrypt Failed"])
      }

      let symmetricKey = sharedSecret.hkdfDerivedSymmetricKey(
        using: SHA256.self,
        salt: salt,
        sharedInfo: Self.messageSharedInfo,
        outputByteCount: 32
      )
      let decryptedData = try ChaChaPoly.open(sealedBox, using: symmetricKey)
      return String(data: decryptedData, encoding: .utf8) ?? ""
    }

    // Legacy v1 path: empty salt + empty sharedInfo. Kept for messages that were
    // already encrypted before the v2 envelope existed. Encryption is rejected
    // for v1 — only decrypt remains.
    guard let sealedBox = try? ChaChaPoly.SealedBox(combined: combinedData) else {
      throw NSError(domain: "Crypto", code: -2, userInfo: [NSLocalizedDescriptionKey: "Decrypt Failed"])
    }
    let legacyKey = sharedSecret.hkdfDerivedSymmetricKey(
      using: SHA256.self,
      salt: Data(),
      sharedInfo: Data(),
      outputByteCount: 32
    )

    let decryptedData = try ChaChaPoly.open(sealedBox, using: legacyKey)
    return String(data: decryptedData, encoding: .utf8) ?? ""
  }

  private static func randomBytes(count: Int) -> Data {
    var bytes = Data(count: count)
    let status = bytes.withUnsafeMutableBytes { buffer -> Int32 in
      guard let baseAddress = buffer.baseAddress else { return errSecParam }
      return SecRandomCopyBytes(kSecRandomDefault, count, baseAddress)
    }
    if status != errSecSuccess {
      // SecRandomCopyBytes failure is exceptional — fall back to CryptoKit's
      // CSPRNG so we never return predictable bytes.
      return SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
    }
    return bytes
  }
}
