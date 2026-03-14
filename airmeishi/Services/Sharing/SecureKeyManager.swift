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
    let symmetricKey = sharedSecret.hkdfDerivedSymmetricKey(
      using: SHA256.self,
      salt: Data(),  // Salt can be empty if not defined by protocol
      sharedInfo: Data(),
      outputByteCount: 32
    )

    // 2. Encrypt
    guard let data = message.data(using: .utf8) else {
      throw NSError(
        domain: "Crypto",
        code: -1,
        userInfo: [NSLocalizedDescriptionKey: "Failed to encode message to UTF-8"]
      )
    }
    let sealedBox = try ChaChaPoly.seal(data, using: symmetricKey)

    // Returns Base64 of Combined Data (Nonce + Ciphertext + Tag)
    return sealedBox.combined.base64EncodedString()
  }

  // --- Feature C: Decrypt Message (Receive Mail) ---
  func decrypt(blobBase64: String, from senderPubKeyBase64: String) throws -> String {
    guard let combinedData = Data(base64Encoded: blobBase64),
      let sealedBox = try? ChaChaPoly.SealedBox(combined: combinedData),
      let senderData = Data(base64Encoded: senderPubKeyBase64),
      let senderKey = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: senderData)
    else {
      throw NSError(domain: "Crypto", code: -2, userInfo: [NSLocalizedDescriptionKey: "Decrypt Failed"])
    }

    let sharedSecret = try encryptionKey.sharedSecretFromKeyAgreement(with: senderKey)
    let symmetricKey = sharedSecret.hkdfDerivedSymmetricKey(
      using: SHA256.self,
      salt: Data(),
      sharedInfo: Data(),
      outputByteCount: 32
    )

    let decryptedData = try ChaChaPoly.open(sealedBox, using: symmetricKey)
    return String(data: decryptedData, encoding: .utf8) ?? ""
  }
}
