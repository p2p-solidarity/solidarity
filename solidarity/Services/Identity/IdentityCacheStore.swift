import Foundation
import Security

/// Lightweight cache backed by Keychain for DID documents and JWK material.
final class IdentityCacheStore {
  private let service = AppBranding.currentIdentityCacheService
  private let documentsAccount = "did-documents"
  private let jwkAccount = "public-jwks"
  private let descriptorAccount = "active-did-descriptor"
  private let queue = DispatchQueue(label: AppBranding.currentIdentityCacheService, qos: .utility)

  func loadDocuments() -> [String: DIDDocument] {
    queue.sync {
      data(for: documentsAccount)
        .flatMap { try? JSONDecoder().decode([String: DIDDocument].self, from: $0) }
        ?? [:]
    }
  }

  func saveDocuments(_ documents: [String: DIDDocument]) {
    queue.async {
      guard let data = try? JSONEncoder().encode(documents) else { return }
      self.store(data, for: self.documentsAccount)
    }
  }

  func loadJwks() -> [String: PublicKeyJWK] {
    queue.sync {
      data(for: jwkAccount)
        .flatMap { try? JSONDecoder().decode([String: PublicKeyJWK].self, from: $0) }
        ?? [:]
    }
  }

  func saveJwks(_ jwks: [String: PublicKeyJWK]) {
    queue.async {
      guard let data = try? JSONEncoder().encode(jwks) else { return }
      self.store(data, for: self.jwkAccount)
    }
  }

  // MARK: - DID Descriptor Cache

  func loadDescriptor() -> DIDDescriptor? {
    queue.sync {
      guard let cached = data(for: descriptorAccount),
            let container = try? JSONDecoder().decode(CachedDescriptor.self, from: cached)
      else { return nil }
      return DIDDescriptor(
        did: container.did,
        verificationMethodId: container.verificationMethodId,
        jwk: container.jwk
      )
    }
  }

  func saveDescriptor(_ descriptor: DIDDescriptor) {
    queue.async {
      let container = CachedDescriptor(
        did: descriptor.did,
        verificationMethodId: descriptor.verificationMethodId,
        jwk: descriptor.jwk
      )
      guard let data = try? JSONEncoder().encode(container) else { return }
      self.store(data, for: self.descriptorAccount)
      #if DEBUG
      print("[IdentityCacheStore] Cached DID descriptor: \(descriptor.did)")
      #endif
    }
  }

  func clearDescriptor() {
    queue.async {
      self.delete(for: self.descriptorAccount)
      #if DEBUG
      print("[IdentityCacheStore] Cleared cached DID descriptor")
      #endif
    }
  }

  /// Synchronous variant that does NOT dispatch through the internal queue.
  /// Safe to call from any thread (SecItemDelete is OS-level thread-safe).
  /// Use when subsequent operations depend on the cache being empty.
  func clearDescriptorSync() {
    delete(for: descriptorAccount)
    #if DEBUG
    print("[IdentityCacheStore] Cleared cached DID descriptor (sync)")
    #endif
  }

  /// Clears all cached identity data: DID documents, JWKs, and active descriptor.
  func clearAll() {
    queue.async {
      self.delete(for: self.documentsAccount)
      self.delete(for: self.jwkAccount)
      self.delete(for: self.descriptorAccount)
      print("[IdentityCacheStore] Cleared all cached identity data")
    }
  }

  private func data(for account: String) -> Data? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]

    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else { return nil }
    return data
  }

  private func store(_ data: Data, for account: String) {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
      kSecValueData as String: data,
    ]

    SecItemDelete(query as CFDictionary)
    let status = SecItemAdd(query as CFDictionary, nil)
    if status == errSecDuplicateItem {
      query.removeValue(forKey: kSecValueData as String)
      let attributes: [String: Any] = [kSecValueData as String: data]
      SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    }
  }

  private func delete(for account: String) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(query as CFDictionary)
  }
}

// MARK: - Codable container for DIDDescriptor

private struct CachedDescriptor: Codable {
  let did: String
  let verificationMethodId: String
  let jwk: PublicKeyJWK
}
