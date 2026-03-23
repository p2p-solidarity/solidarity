import CryptoKit
import Foundation
import Security
import XCTest
@testable import solidarity

final class BrandMigrationTests: XCTestCase {
  private struct SecretPayload: Codable, Equatable {
    let message: String
  }

  func testEncryptionManagerMigratesLegacyKeychainItemToSolidarityNamespace() throws {
    let suffix = UUID().uuidString
    let currentTag = "com.kidneyweakx.solidarity.encryption.key.\(suffix)"
    let legacyTag = "com.kidneyweakx.airmeishi.encryption.key.\(suffix)"
    let currentService = "solidarity.\(suffix)"
    let legacyService = "airmeishi.\(suffix)"
    let manager = EncryptionManager(
      keyTag: currentTag,
      legacyKeyTag: legacyTag,
      service: currentService,
      legacyService: legacyService
    )
    let legacyKey = SymmetricKey(size: .bits256)

    try storeKey(legacyKey, service: legacyService, account: legacyTag)
    defer {
      deleteKey(service: currentService, account: currentTag)
      deleteKey(service: legacyService, account: legacyTag)
    }

    let payload = SecretPayload(message: "migrate me")
    guard case .success(let encrypted) = manager.encrypt(payload) else {
      XCTFail("Expected encryption to succeed with migrated legacy key")
      return
    }

    guard case .success(let decrypted) = manager.decrypt(encrypted, as: SecretPayload.self) else {
      XCTFail("Expected decryption to succeed after migration")
      return
    }

    XCTAssertEqual(decrypted, payload)
    XCTAssertEqual(loadKeyData(service: currentService, account: currentTag), keyData(for: legacyKey))
    XCTAssertEqual(loadKeyData(service: legacyService, account: legacyTag), keyData(for: legacyKey))
  }

  func testIssuerTrustAnchorStoreMigratesLegacyDefaultsKey() throws {
    let suiteName = "BrandMigrationTests.\(UUID().uuidString)"
    guard let defaults = UserDefaults(suiteName: suiteName) else {
      XCTFail("Expected isolated defaults suite")
      return
    }
    defaults.removePersistentDomain(forName: suiteName)
    defer {
      defaults.removePersistentDomain(forName: suiteName)
    }

    let legacyKey = "airmeishi.trusted_issuer_anchors.v1"
    let currentKey = "solidarity.trusted_issuer_anchors.v1"
    let anchors = [
      TrustedIssuerAnchor(
        issuerDid: "did:example:issuer",
        publicKeyJwk: PublicKeyJWK(
          kty: "EC",
          crv: "P-256",
          alg: "ES256",
          x: "xValue",
          y: "yValue"
        ),
        keyId: "did:example:issuer#key-1",
        source: "test",
        updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
      )
    ]

    defaults.set(try JSONEncoder().encode(anchors), forKey: legacyKey)

    let store = IssuerTrustAnchorStore(defaults: defaults, didService: DIDService())

    XCTAssertEqual(store.allAnchors(), anchors)
    XCTAssertNil(defaults.object(forKey: legacyKey))
    XCTAssertNotNil(defaults.data(forKey: currentKey))
  }

  private func keyData(for key: SymmetricKey) -> Data {
    key.withUnsafeBytes { Data($0) }
  }

  private func storeKey(_ key: SymmetricKey, service: String, account: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecValueData as String: keyData(for: key),
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]
    SecItemDelete(query as CFDictionary)
    let status = SecItemAdd(query as CFDictionary, nil)
    XCTAssertEqual(status, errSecSuccess)
  }

  private func loadKeyData(service: String, account: String) -> Data? {
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

  private func deleteKey(service: String, account: String) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(query as CFDictionary)
  }
}
