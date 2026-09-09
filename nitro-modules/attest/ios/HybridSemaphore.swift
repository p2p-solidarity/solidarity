//
//  HybridSemaphore.swift
//  @solidarity/nitro-semaphore (iOS)
//
//  Wraps semaphore-rs for on-device Semaphore identity + membership proofs.
//  Uses SemaphoreShim (same Swift module) to call mopro.swift's top-level
//  functions without recursing into our own protocol method names — same
//  pattern as HybridPassportZk.swift / MoproShim.swift.
//
//  Identity material is persisted to the iOS Keychain under the alias
//  `com.kidneyweakx.solidarity.semaphore.identity` so it matches the
//  legacy Swift app (see solidarity/Services/Utils/Branding.swift:27).
//  Nullifiers go under `solidarity.zk.nullifiers` to mirror
//  solidarity/Services/ZK/NullifierStore.swift.
//
import Foundation
import NitroModules
import Security
@_implementationOnly import SemaphoreBindings

final class HybridSemaphore: HybridSemaphoreSpec {

  // MARK: - Constants (must match Swift Branding.swift + NullifierStore.swift)

  private static let defaultIdentityAlias = "com.kidneyweakx.solidarity.semaphore.identity"
  private static let legacyIdentityAlias = "com.kidneyweakx.airmeishi.semaphore.identity"
  private static let nullifierStoreAlias = "solidarity.zk.nullifiers"

  // MARK: - In-memory cache (single active identity)

  private let cacheQueue = DispatchQueue(label: "solidarity.semaphore.cache")
  private var cachedIdentity: Identity?
  private var cachedPrivateKey: Data?
  private var cachedCommitment: String = ""

  // MARK: - Identity

  func generateIdentity() throws -> Promise<String> {
    return Promise.async {
      let secret = Self.randomSecret32()
      return try self.installIdentity(secret: secret)
    }
  }

  func identityFromSeed(seed: ArrayBuffer) throws -> Promise<String> {
    // Copy the NON-OWNING JS ArrayBuffer synchronously, before Promise.async —
    // touching seed.data/.size on the async executor (another thread, later)
    // traps the process (SIGTRAP) and is uncatchable by JS try/catch.
    let bytes = Data(bytes: seed.data, count: seed.size)
    return Promise.async {
      guard bytes.count == 32 else {
        throw HybridError.invalidSeed(bytes.count)
      }
      return try self.installIdentity(secret: bytes)
    }
  }

  func getCommitment() throws -> String {
    cacheQueue.sync { cachedCommitment }
  }

  func loadIdentityFromKeychain(alias: String) throws -> Promise<Bool> {
    return Promise.async {
      let resolvedAlias = alias.isEmpty ? Self.defaultIdentityAlias : alias
      if let bytes = Self.readKeychain(alias: resolvedAlias) {
        try self.adoptStoredKey(bytes)
        return true
      }
      // Mirror SemaphoreIdentityManager's legacy-alias migration.
      if alias.isEmpty,
         let legacy = Self.readKeychain(alias: Self.legacyIdentityAlias) {
        try self.adoptStoredKey(legacy)
        Self.writeKeychain(alias: Self.defaultIdentityAlias, data: legacy)
        return true
      }
      return false
    }
  }

  func storeIdentityToKeychain(alias: String) throws -> Promise<Void> {
    return Promise.async {
      let resolvedAlias = alias.isEmpty ? Self.defaultIdentityAlias : alias
      guard let bytes = self.cacheQueue.sync(execute: { self.cachedPrivateKey }) else {
        throw HybridError.identityNotLoaded
      }
      let ok = Self.writeKeychain(alias: resolvedAlias, data: bytes)
      if !ok { throw HybridError.keychainWriteFailed }
    }
  }

  func deleteIdentity() throws -> Promise<Void> {
    return Promise.async {
      try Self.deleteKeychain(alias: Self.defaultIdentityAlias)
      try Self.deleteKeychain(alias: Self.legacyIdentityAlias)
      try Self.deleteKeychain(alias: Self.nullifierStoreAlias)
      self.cacheQueue.sync {
        self.cachedIdentity = nil
        self.cachedPrivateKey = nil
        self.cachedCommitment = ""
      }
    }
  }

  func exportPrivateKey() throws -> Promise<ArrayBuffer> {
    return Promise.async {
      guard let bytes = self.cacheQueue.sync(execute: { self.cachedPrivateKey }) else {
        throw HybridError.identityNotLoaded
      }
      return try ArrayBuffer.copy(data: bytes)
    }
  }

  func importPrivateKey(bytes: ArrayBuffer) throws -> Promise<String> {
    // Copy the NON-OWNING JS ArrayBuffer synchronously, before Promise.async —
    // touching bytes.data/.size on the async executor traps the process
    // (SIGTRAP) and is uncatchable by JS try/catch.
    let data = Data(bytes: bytes.data, count: bytes.size)
    return Promise.async {
      guard data.count == 32 else {
        throw HybridError.invalidSeed(data.count)
      }
      return try self.installIdentity(secret: data)
    }
  }

  // MARK: - Group root

  func groupRootFromCommitments(commitments: [String]) throws -> Promise<String> {
    return Promise.async {
      let canonical = SemaphoreShim.canonicalCommitments(commitments)
      guard !canonical.isEmpty else { return "0" }
      return try SemaphoreShim.groupRoot(commitments: canonical)
    }
  }

  // MARK: - Proof gen + verify

  func generateProof(
    commitments: [String],
    scope: String,
    signal: String
  ) throws -> Promise<SemaphoreProof> {
    return Promise.async {
      guard let identity = self.cacheQueue.sync(execute: { self.cachedIdentity }) else {
        throw HybridError.identityNotLoaded
      }
      let commitment = self.cacheQueue.sync { self.cachedCommitment }
      let merged = commitments + [commitment]
      let canonical = SemaphoreShim.canonicalCommitments(merged)
      guard canonical.count > 1 else {
        throw HybridError.insufficientGroupContext
      }
      let parts = try SemaphoreShim.generateProof(
        identity: identity,
        groupCommitments: canonical,
        message: signal,
        scope: scope,
        merkleTreeDepth: 16
      )
      let proofJSON = try Self.reencode(parts: parts)
      return SemaphoreProof(
        nullifier: parts.nullifier,
        merkleRoot: parts.merkleRoot,
        scope: parts.scope,
        signal: parts.message,
        proofJson: proofJSON,
        merkleTreeDepth: Double(parts.merkleTreeDepth)
      )
    }
  }

  func verifyProof(proof: SemaphoreProof, merkleTreeDepth: Double) throws -> Promise<Bool> {
    return Promise.async {
      return try SemaphoreShim.verifyProof(rawJSON: proof.proofJson)
    }
  }

  func extractNullifier(proof: SemaphoreProof) throws -> String {
    proof.nullifier
  }

  // MARK: - Nullifier store

  func hasNullifier(scope: String, nullifier: String) throws -> Bool {
    Self.nullifierSet().contains(Self.nullifierKey(scope: scope, nullifier: nullifier))
  }

  func recordNullifier(scope: String, nullifier: String) throws -> Void {
    var set = Self.nullifierSet()
    set.insert(Self.nullifierKey(scope: scope, nullifier: nullifier))
    Self.persistNullifierSet(set)
  }

  // MARK: - Private — identity lifecycle

  private func installIdentity(secret: Data) throws -> String {
    let (commitment, identity) = SemaphoreShim.makeIdentity(secret: secret)
    cacheQueue.sync {
      self.cachedIdentity = identity
      self.cachedPrivateKey = secret
      self.cachedCommitment = commitment
    }
    Self.writeKeychain(alias: Self.defaultIdentityAlias, data: secret)
    return commitment
  }

  private func adoptStoredKey(_ bytes: Data) throws {
    let identity = SemaphoreShim.loadIdentity(privateKey: bytes)
    let commitment = identity.commitment()
    cacheQueue.sync {
      self.cachedIdentity = identity
      self.cachedPrivateKey = bytes
      self.cachedCommitment = commitment
    }
  }

  private static func randomSecret32() -> Data {
    var buf = [UInt8](repeating: 0, count: 32)
    _ = SecRandomCopyBytes(kSecRandomDefault, buf.count, &buf)
    return Data(buf)
  }

  // MARK: - Private — Keychain helpers (identity)

  private static func writeKeychain(alias: String, data: Data) -> Bool {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: alias,
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]
    SecItemDelete(query as CFDictionary)
    return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
  }

  private static func readKeychain(alias: String) -> Data? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: alias,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else { return nil }
    return data
  }

  private static func deleteKeychain(alias: String) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: alias,
    ]
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw HybridError.keychainDeleteFailed(status)
    }
  }

  // MARK: - Private — Nullifier store (Keychain-backed)

  private static func nullifierKey(scope: String, nullifier: String) -> String {
    "\(scope)|\(nullifier)"
  }

  private static func nullifierSet() -> Set<String> {
    guard let bytes = readKeychain(alias: nullifierStoreAlias) else { return [] }
    guard let list = try? JSONDecoder().decode([String].self, from: bytes) else { return [] }
    return Set(list)
  }

  private static func persistNullifierSet(_ set: Set<String>) {
    guard let payload = try? JSONEncoder().encode(Array(set)) else { return }
    _ = writeKeychain(alias: nullifierStoreAlias, data: payload)
  }

  // MARK: - Private — proof re-encode

  /// Re-emit the proof JSON in a canonical shape so JS can rely on
  /// stable key names. We keep the raw `points` sub-blob verbatim so
  /// the cryptographic verifier still sees the input it was given.
  private static func reencode(parts: ShimProofParts) throws -> String {
    var obj: [String: Any] = [
      "merkle_tree_depth": Int(parts.merkleTreeDepth),
      "merkle_tree_root": parts.merkleRoot,
      "nullifier": parts.nullifier,
      "message": parts.message,
      "scope": parts.scope,
    ]
    if let pointsData = parts.points.data(using: .utf8),
       let pointsAny = try? JSONSerialization.jsonObject(with: pointsData) {
      obj["points"] = pointsAny
    }
    let data = try JSONSerialization.data(withJSONObject: obj,
                                          options: [.sortedKeys])
    return String(data: data, encoding: .utf8) ?? "{}"
  }
}

// MARK: - Errors

private enum HybridError: Swift.Error, LocalizedError {
  case identityNotLoaded
  case invalidSeed(Int)
  case insufficientGroupContext
  case keychainWriteFailed
  case keychainDeleteFailed(OSStatus)

  var errorDescription: String? {
    switch self {
    case .identityNotLoaded:
      return "Semaphore identity is not loaded; call generateIdentity() or loadIdentityFromKeychain() first."
    case .invalidSeed(let n):
      return "Seed must be exactly 32 bytes (got \(n))."
    case .insufficientGroupContext:
      return "Proof requires at least 2 distinct member commitments."
    case .keychainWriteFailed:
      return "Failed to persist identity to the iOS Keychain."
    case .keychainDeleteFailed(let status):
      return "Failed to delete identity from the iOS Keychain (status=\(status))."
    }
  }
}
