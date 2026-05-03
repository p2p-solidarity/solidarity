//
//  SecurityStoreTests.swift
//  solidarityTests
//
//  Coverage for the small Keychain-backed stores added in the security
//  hardening round: NullifierStore, OIDCNonceStore, and the SPKI pin
//  source-of-truth `MessageServerPinning`.
//

import CryptoKit
import XCTest

@testable import solidarity

final class SecurityStoreTests: XCTestCase {

  // MARK: - NullifierStore

  func testNullifierStoreRecordsAndDetectsReplay() {
    let store = NullifierStore.shared
    store.reset()

    let scope = "test.scope.\(UUID().uuidString)"
    let nullifier = "n-\(UUID().uuidString)"

    XCTAssertFalse(store.hasSeen(scope: scope, nullifier: nullifier))
    store.record(scope: scope, nullifier: nullifier)
    XCTAssertTrue(store.hasSeen(scope: scope, nullifier: nullifier))
  }

  func testNullifierStoreScopesAreIndependent() {
    let store = NullifierStore.shared
    store.reset()

    let nullifier = "n-\(UUID().uuidString)"
    store.record(scope: "scope.a", nullifier: nullifier)

    XCTAssertTrue(store.hasSeen(scope: "scope.a", nullifier: nullifier))
    XCTAssertFalse(store.hasSeen(scope: "scope.b", nullifier: nullifier))
  }

  // MARK: - OIDCNonceStore

  func testOIDCNonceStoreRoundTripsWithinTTL() {
    let store = OIDCNonceStore.shared
    store.reset()

    let now = Date()
    let nonces: [String: Date] = [
      "alpha": now.addingTimeInterval(-30),
      "bravo": now.addingTimeInterval(-60),
    ]
    store.save(nonces, ttl: 600, now: now)
    flushNonceQueue()

    let loaded = store.load()
    XCTAssertEqual(loaded["alpha"].map { Int($0.timeIntervalSince1970) },
                   nonces["alpha"].map { Int($0.timeIntervalSince1970) })
    XCTAssertEqual(loaded["bravo"].map { Int($0.timeIntervalSince1970) },
                   nonces["bravo"].map { Int($0.timeIntervalSince1970) })
  }

  func testOIDCNonceStoreDropsExpiredEntries() {
    let store = OIDCNonceStore.shared
    store.reset()

    let now = Date()
    let nonces: [String: Date] = [
      "fresh": now.addingTimeInterval(-30),
      "stale": now.addingTimeInterval(-3600),
    ]
    store.save(nonces, ttl: 60, now: now)
    flushNonceQueue()

    let loaded = store.load()
    XCTAssertNotNil(loaded["fresh"])
    XCTAssertNil(loaded["stale"])
  }

  // MARK: - MessageServerPinning

  func testPinnedHostHasNoPinsUntilProductionConfigured() {
    let pins = MessageServerPinning.pinnedSPKIHashes(for: MessageService.pinnedHost)
    XCTAssertTrue(
      pins.isEmpty,
      "Pin set must remain empty until a real SPKI hash is configured for the messaging backend."
    )
  }

  func testUnknownHostHasNoPins() {
    XCTAssertTrue(
      MessageServerPinning.pinnedSPKIHashes(for: "example.invalid").isEmpty
    )
  }

  func testFallbackPolicyReflectsBuildConfiguration() {
    #if DEBUG
      XCTAssertTrue(
        MessageServerPinning.allowsUnpinnedFallback,
        "DEBUG builds must keep development unblocked."
      )
    #else
      XCTAssertFalse(
        MessageServerPinning.allowsUnpinnedFallback,
        "Release builds must NOT trust an unpinned cert when the pin set is empty."
      )
    #endif
  }

  // MARK: - WrappedShardEnvelope

  func testWrappedShardEnvelopeRejectsBindingMismatch() throws {
    let wrapKey = SymmetricKey(size: .bits256)
    let share = Data(repeating: 0xA1, count: 32)
    let vaultId = UUID()
    let guardianId = UUID()
    let shardIndex = 1
    let threshold = 3

    let envelope = try WrappedShardEnvelope.seal(
      share: share,
      vaultId: vaultId,
      guardianContactId: guardianId,
      shardIndex: shardIndex,
      threshold: threshold,
      wrapKey: wrapKey
    )

    let opened = try envelope.open(
      wrapKey: wrapKey,
      expectedVaultId: vaultId,
      expectedGuardianContactId: guardianId,
      expectedShardIndex: shardIndex,
      expectedThreshold: threshold
    )
    XCTAssertEqual(opened, share)

    XCTAssertThrowsError(
      try envelope.open(
        wrapKey: wrapKey,
        expectedVaultId: vaultId,
        expectedGuardianContactId: guardianId,
        expectedShardIndex: shardIndex + 1,
        expectedThreshold: threshold
      )
    ) { error in
      guard let wrapError = error as? WrappedShardEnvelope.WrapError else {
        XCTFail("Unexpected error type: \(error)")
        return
      }
      if case .bindingMismatch = wrapError { return }
      XCTFail("Expected .bindingMismatch, got \(wrapError)")
    }
  }

  // MARK: - IssuerTrustAnchorStore

  func testIssuerTrustAnchorMatchesByKeyIdSuffix() {
    let defaults = UserDefaults(suiteName: "issuerAnchorTest.\(UUID().uuidString)")!
    let store = IssuerTrustAnchorStore(defaults: defaults, didService: DIDService())
    let issuer = "did:web:issuer.example.com"
    let jwk = makeTestJWK()

    store._registerAnchorInternal(
      issuerDid: issuer,
      publicKeyJwk: jwk,
      keyId: "did:web:issuer.example.com#key-1"
    )

    let lookup = store.trustedJWK(for: issuer, keyId: "key-1")
    XCTAssertEqual(lookup, jwk, "Bare key suffix should match the stored fully-qualified verification method id.")
  }

  func testIssuerTrustAnchorNormalizesDidCase() {
    let defaults = UserDefaults(suiteName: "issuerAnchorTest.\(UUID().uuidString)")!
    let store = IssuerTrustAnchorStore(defaults: defaults, didService: DIDService())
    let jwk = makeTestJWK()

    store._registerAnchorInternal(
      issuerDid: "did:web:Issuer.Example.COM",
      publicKeyJwk: jwk,
      keyId: nil
    )

    XCTAssertNotNil(
      store.trustedJWK(for: "  did:web:issuer.example.com  ", keyId: nil),
      "Lookups should be whitespace- and case-insensitive."
    )
  }

  func testIssuerTrustAnchorRejectsUnknownIssuer() {
    let defaults = UserDefaults(suiteName: "issuerAnchorTest.\(UUID().uuidString)")!
    let store = IssuerTrustAnchorStore(defaults: defaults, didService: DIDService())

    XCTAssertNil(store.trustedJWK(for: "did:web:not-registered.example.com", keyId: nil))
    XCTAssertFalse(store.isTrustedIssuer("did:web:not-registered.example.com", keyId: nil))
  }

  // MARK: - PassportAnchorCommitmentStore

  func testPassportAnchorIsStableAcrossReads() {
    let store = PassportAnchorCommitmentStore.shared
    store.reset()

    let first = store.value
    let second = store.value
    XCTAssertEqual(first, second, "Subsequent reads must return the same per-install commitment.")
  }

  func testPassportAnchorRotatesAfterReset() {
    let store = PassportAnchorCommitmentStore.shared
    store.reset()
    let original = store.value
    store.reset()
    let regenerated = store.value
    XCTAssertNotEqual(
      original,
      regenerated,
      "After reset() the store must regenerate, not reuse, the previous random value."
    )
  }

  func testPassportAnchorIsDecimalAndFitsBN254() {
    let store = PassportAnchorCommitmentStore.shared
    store.reset()
    let value = store.value

    XCTAssertFalse(value.isEmpty)
    XCTAssertTrue(value.allSatisfy { $0.isASCII && $0.isNumber }, "Anchor must be decimal-only.")
    // 31 random bytes => decimal length ≤ 75 (2^248 ≈ 4.5e74).
    XCTAssertLessThanOrEqual(value.count, 75)
  }

  // MARK: - VaultSecretsKeychain (generic 32-byte secret slot)

  func testVaultSecretRoundTripsAndDeletes() throws {
    let service = "solidarity.test.vaultSecret.\(UUID().uuidString)"
    let account = "test-account"
    let payload = Data((0..<32).map { _ in UInt8.random(in: 0...255) })

    try VaultSecretsKeychain.storeData(payload, service: service, account: account)
    let loaded = try VaultSecretsKeychain.loadData(service: service, account: account)
    XCTAssertEqual(loaded, payload)

    try VaultSecretsKeychain.deleteData(service: service, account: account)
    let afterDelete = try VaultSecretsKeychain.loadData(service: service, account: account)
    XCTAssertNil(afterDelete, "Delete should leave a missing slot returning nil, not throw.")
  }

  func testVaultSecretOverwritesExisting() throws {
    let service = "solidarity.test.vaultSecret.\(UUID().uuidString)"
    let account = "test-account"
    let first = Data(repeating: 0x11, count: 32)
    let second = Data(repeating: 0x22, count: 32)

    try VaultSecretsKeychain.storeData(first, service: service, account: account)
    try VaultSecretsKeychain.storeData(second, service: service, account: account)
    let loaded = try VaultSecretsKeychain.loadData(service: service, account: account)
    XCTAssertEqual(loaded, second)

    try VaultSecretsKeychain.deleteData(service: service, account: account)
  }

  // MARK: - Helpers

  private func flushNonceQueue() {
    // OIDCNonceStore.save dispatches asynchronously. Round-trip a sync
    // call to its own queue so the persisted bytes are flushed before
    // we read them back.
    _ = OIDCNonceStore.shared.load()
  }

  private func makeTestJWK() -> PublicKeyJWK {
    PublicKeyJWK(
      kty: "EC",
      crv: "P-256",
      alg: "ES256",
      x: "x".padding(toLength: 43, withPad: "x", startingAt: 0),
      y: "y".padding(toLength: 43, withPad: "y", startingAt: 0)
    )
  }
}
