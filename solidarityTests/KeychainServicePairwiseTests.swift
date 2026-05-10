import Foundation
import Testing
@testable import solidarity

struct KeychainServicePairwiseTests {
  /// Master alias evolution:
  ///   airmeishi.did.signing → solidarity.master → solidarity.master.v2
  /// The v2 roll bypasses iCloud Keychain phantom entries that accumulated
  /// under the v1 tag and could not be cleared via attribute-based delete.
  /// Both prior aliases are retained as migration sources.
  @Test func testMasterAliasMigratedToSolidarityV2() async throws {
    // Default test environment: useLocalAliasMarker unset → resolves to v2.
    #expect(KeychainService.masterAlias == "solidarity.master.v2")
    #expect(KeychainService.v1MasterAlias == "solidarity.master")
    #expect(KeychainService.legacyMasterAlias == "airmeishi.did.signing")
    #expect(KeychainService.localMasterAlias == "solidarity.master.local")
  }

  /// Toggling `useLocalAliasMarker` in `UserDefaults` flips the computed
  /// `masterAlias` to the local-only escape hatch. The shared singleton has
  /// already captured the alias at this point, so production code requires a
  /// relaunch — this test checks only the static computation.
  @Test func testMasterAliasFollowsUseLocalAliasMarker() async throws {
    let key = KeychainService.useLocalAliasMarker
    let original = UserDefaults.standard.bool(forKey: key)
    defer { UserDefaults.standard.set(original, forKey: key) }

    UserDefaults.standard.set(false, forKey: key)
    #expect(KeychainService.masterAlias == "solidarity.master.v2")

    UserDefaults.standard.set(true, forKey: key)
    #expect(KeychainService.masterAlias == "solidarity.master.local")
  }

  @Test func testPairwiseAliasSanitizesDomain() async throws {
    let alias = KeychainService.rpAlias(for: "https://Verifier.Example.com/login")
    #expect(alias == "airmeishi.did.rp.verifier.example.com-login")
  }

  @Test func testPairwiseAliasIsStable() async throws {
    let first = KeychainService.rpAlias(for: "issuer.example.com")
    let second = KeychainService.rpAlias(for: "issuer.example.com/")
    #expect(first == second)
  }

  @Test func testSoftwareDeviceKeyAttributesKeepKeychainMetadataOnPrivateKey() async throws {
    let service = KeychainService(alias: KeychainService.localMasterAlias)

    let attributes = service.persistentDeviceKeyAttributes(useSecureEnclave: false)
    let privateAttributes = try #require(attributes[kSecPrivateKeyAttrs as String] as? [String: Any])

    #expect(attributes[kSecAttrKeyType as String] as? String == (kSecAttrKeyTypeECSECPrimeRandom as String))
    #expect(attributes[kSecAttrKeySizeInBits as String] as? Int == 256)
    #expect(privateAttributes[kSecAttrApplicationTag as String] as? Data == Data(KeychainService.localMasterAlias.utf8))
    #expect(privateAttributes[kSecAttrKeyClass as String] == nil)
    #expect(privateAttributes[kSecAttrSynchronizable as String] as? Bool == false)
  }

  @Test func testPrivateKeyImportQueryCarriesKeyMetadata() async throws {
    let service = KeychainService(alias: KeychainService.localMasterAlias)
    let privateData = Data(repeating: 0x7A, count: 32)

    let query = service.privateKeyImportQuery(privateData: privateData)

    #expect(query[kSecClass as String] as? String == (kSecClassKey as String))
    #expect(query[kSecAttrKeyType as String] as? String == (kSecAttrKeyTypeECSECPrimeRandom as String))
    #expect(query[kSecAttrKeyClass as String] as? String == (kSecAttrKeyClassPrivate as String))
    #expect(query[kSecAttrApplicationTag as String] as? Data == Data(KeychainService.localMasterAlias.utf8))
    #expect(query[kSecValueData as String] as? Data == privateData)
    #expect(query[kSecAttrSynchronizable as String] as? Bool == false)
  }
}
