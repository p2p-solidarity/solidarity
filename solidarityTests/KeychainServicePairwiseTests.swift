import Testing
@testable import solidarity

struct KeychainServicePairwiseTests {
  /// Master alias migrated from "airmeishi.did.signing" → "solidarity.master"
  /// during the project rename. The legacy constant is retained on
  /// `KeychainService.legacyMasterAlias` so first-run migration can find
  /// keys that pre-date the rename.
  @Test func testMasterAliasMigratedToSolidarityPrefix() async throws {
    #expect(KeychainService.masterAlias == "solidarity.master")
    #expect(KeychainService.legacyMasterAlias == "airmeishi.did.signing")
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
}
