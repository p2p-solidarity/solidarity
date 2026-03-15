import CryptoKit
import XCTest
@testable import airmeishi

final class EncryptionManagerTests: XCTestCase {
  private struct SecretPayload: Codable, Equatable {
    let message: String
  }

  override func setUpWithError() throws {
    _ = EncryptionManager.shared.deleteEncryptionKey()
  }

  override func tearDownWithError() throws {
    _ = EncryptionManager.shared.deleteEncryptionKey()
  }

  func testStoreKeyInKeychainHandlesDuplicateByUpdatingItem() throws {
    let key1 = SymmetricKey(size: .bits256)
    let key2 = SymmetricKey(size: .bits256)

    XCTAssertNoThrow(try EncryptionManager.shared.storeKeyInKeychain(key1))
    XCTAssertNoThrow(try EncryptionManager.shared.storeKeyInKeychain(key2))

    let payload = SecretPayload(message: "hello")
    guard case .success(let encrypted) = EncryptionManager.shared.encrypt(payload) else {
      XCTFail("Expected encryption to succeed after duplicate key update")
      return
    }
    guard case .success(let decrypted) = EncryptionManager.shared.decrypt(encrypted, as: SecretPayload.self) else {
      XCTFail("Expected decryption to succeed after duplicate key update")
      return
    }
    XCTAssertEqual(decrypted, payload)
  }
}
