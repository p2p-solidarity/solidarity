import Testing
@testable import solidarity

struct KeychainServicePairwiseTests {
  @Test func testMasterAliasKeepsLegacyTag() async throws {
    #expect(KeychainService.masterAlias == "airmeishi.did.signing")
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
