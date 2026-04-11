import CryptoKit
import Security
import XCTest
@testable import solidarity

final class KeyManagerMigrationTests: XCTestCase {
  private let manager = KeyManager.shared
  private let keychain = KeychainManager()

  override func setUpWithError() throws {
    cleanupAllTestTags()
  }

  override func tearDownWithError() throws {
    cleanupAllTestTags()
  }

  /// `KeychainManager.deleteKey` omits `kSecAttrSynchronizable`, so it misses
  /// items stored with `synchronizable: true`. Use raw SecItemDelete with
  /// `kSecAttrSynchronizableAny` to guarantee full cleanup.
  private func cleanupAllTestTags() {
    for keyId in KeyManager.KeyIdentifier.allCases {
      for tag in keyId.allTags {
        let query: [String: Any] = [
          kSecClass as String: kSecClassGenericPassword,
          kSecAttrAccount as String: tag,
          kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
        ]
        SecItemDelete(query as CFDictionary)
      }
    }
  }

  // MARK: - Migration: old tag → new tag

  func testRetrievesMasterKeyFromLegacyPrimaryTagAndMigrates() throws {
    let originalKey = SymmetricKey(size: .bits256)
    let legacyTag = KeyManager.KeyIdentifier.masterKey.legacyPrimaryTags[0]

    // Seed under the OLD primaryTag ("solidarity.master")
    let storeResult = keychain.storeSymmetricKey(originalKey, tag: legacyTag)
    guard case .success = storeResult else {
      XCTFail("Failed to seed legacy key: \(storeResult)")
      return
    }

    // Retrieve through KeyManager — should find via legacyPrimaryTag fallback
    let retrieveResult = manager.retrieveSymmetricKey(.masterKey)
    guard case .success(let retrieved) = retrieveResult else {
      XCTFail("Expected successful retrieval from legacy tag: \(retrieveResult)")
      return
    }

    // Verify key data matches
    let originalData = originalKey.withUnsafeBytes { Data($0) }
    let retrievedData = retrieved.withUnsafeBytes { Data($0) }
    XCTAssertEqual(originalData, retrievedData, "Retrieved key should match the original")

    // Verify migration: key should now exist under the NEW primaryTag
    let newTag = KeyManager.KeyIdentifier.masterKey.primaryTag
    let newResult = keychain.retrieveSymmetricKey(tag: newTag)
    guard case .success(let migratedKey) = newResult else {
      XCTFail("Key should have been migrated to new primaryTag '\(newTag)'")
      return
    }
    let migratedData = migratedKey.withUnsafeBytes { Data($0) }
    XCTAssertEqual(originalData, migratedData, "Migrated key should match the original")
  }

  // MARK: - clearAllKeys covers all tags

  func testClearAllKeysDeletesNewAndLegacyTags() throws {
    let key = SymmetricKey(size: .bits256)
    let masterKeyId = KeyManager.KeyIdentifier.masterKey

    // Seed keys under every known tag variant
    for tag in masterKeyId.allTags {
      let result = keychain.storeSymmetricKey(key, tag: tag)
      guard case .success = result else {
        XCTFail("Failed to seed key for tag '\(tag)': \(result)")
        return
      }
    }

    // Verify at least one is readable
    let beforeResult = keychain.retrieveSymmetricKey(tag: masterKeyId.primaryTag)
    guard case .success = beforeResult else {
      XCTFail("Setup: key should be readable before clear")
      return
    }

    // Clear via KeyManager
    _ = manager.clearAllKeys()

    // Verify ALL tags are gone (use raw query to bypass the sync-attr gap)
    for tag in masterKeyId.allTags {
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrAccount as String: tag,
        kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne,
      ]
      var result: AnyObject?
      let status = SecItemCopyMatching(query as CFDictionary, &result)
      XCTAssertNotEqual(
        status, errSecSuccess,
        "Key should have been deleted for tag '\(tag)' after clearAllKeys()"
      )
    }
  }
}
