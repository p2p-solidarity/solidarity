//
//  SemaphoreIdentityManager.swift
//  solidarity
//
//  Manages Semaphore identity lifecycle, commitments, and proof helpers.
//  Uses Keychain to store the private identity secret locally.
//

import CryptoKit
import Foundation

#if canImport(Semaphore) && !(targetEnvironment(simulator) && arch(x86_64))
  import Semaphore
#endif

/// Stores and manages Semaphore identity material. All identity secrets stay local.
final class SemaphoreIdentityManager: ObservableObject {
  static let shared = SemaphoreIdentityManager()

  private let keychain: IdentityBundleStore

  init(keychain: IdentityBundleStore = KeychainIdentityStore()) {
    self.keychain = keychain
  }

  /// Bootstrap anchor commitment for passport self-attestation proofs.
  /// A fixed decimal field element used as the second member in a minimal 2-member group,
  /// enabling passport ZK proofs before the user joins any peer group.
  static let passportAnchorCommitment = "7891011121314151617181920212223242526272829303132"

  // Whether the SemaphoreSwift library is available for proof ops
  static var proofsSupported: Bool {
    #if canImport(Semaphore) && !(targetEnvironment(simulator) && arch(x86_64))
      return true
    #else
      return false
    #endif
  }

  struct IdentityBundle: Codable, Equatable {
    let privateKey: Data  // trapdoor + nullifier source (as used by SemaphoreSwift)
    let commitment: String  // public commitment hex/string
  }

  struct ProofEnvelope: Codable, Equatable {
    let version: Int
    let semaphoreProof: String
    let groupRoot: String
    let signal: String
    let scope: String
    let memberCount: Int
    let commitments: [String]

    enum CodingKeys: String, CodingKey {
      case version
      case semaphoreProof = "semaphore_proof"
      case groupRoot = "group_root"
      case signal
      case scope
      case memberCount = "member_count"
      case commitments = "group_commitments"
    }
  }

  enum Error: Swift.Error {
    case notInitialized
    case storageFailed(String)
    case unsupported
    case invalidCommitment(String)
    case groupConstructionFailed(String)
    case insufficientGroupContext(String)
  }

  // MARK: - Identity

  /// Load existing identity or create a new one with random secret.
  func loadOrCreateIdentity() throws -> IdentityBundle {
    if let existing = try? keychain.loadIdentity() {
      let fixed = ensureCommitment(bundle: existing)
      if fixed.commitment != existing.commitment {
        try? keychain.storeIdentity(fixed)
        ZKLog.info("Migrated empty commitment → prefix: \(fixed.commitment.prefix(8))")
      } else {
        ZKLog.info("Loaded existing identity with commitment prefix: \(existing.commitment.prefix(8))")
      }
      return fixed
    }

    let secret = randomSecret32()

    #if canImport(Semaphore) && !(targetEnvironment(simulator) && arch(x86_64))
      let identity = Identity(privateKey: secret)
      let commitment = identity.commitment()
      let bundle = IdentityBundle(privateKey: secret, commitment: commitment)
      try keychain.storeIdentity(bundle)
      ZKLog.info("Created identity (semaphore). commitment prefix: \(commitment.prefix(8))")
      return bundle
    #else
      let bundle = IdentityBundle(privateKey: secret, commitment: fallbackCommitment(from: secret))
      try keychain.storeIdentity(bundle)
      ZKLog.info("Created identity (fallback). commitment prefix: \(bundle.commitment.prefix(8))")
      return bundle
    #endif
  }

  /// Returns current identity bundle if present.
  func getIdentity() -> IdentityBundle? {
    guard let loaded = try? keychain.loadIdentity() else { return nil }
    let fixed = ensureCommitment(bundle: loaded)
    if fixed.commitment != loaded.commitment { try? keychain.storeIdentity(fixed) }
    return fixed
  }

  func migrateLegacyIdentityIfNeeded() {
    _ = try? keychain.loadIdentity()
  }

  /// Replaces identity with provided secret bytes.
  func importIdentity(privateKey: Data) throws -> IdentityBundle {
    #if canImport(Semaphore) && !(targetEnvironment(simulator) && arch(x86_64))
      let identity = Identity(privateKey: privateKey)
      let commitment = identity.commitment()
      let bundle = IdentityBundle(privateKey: privateKey, commitment: commitment)
      try keychain.storeIdentity(bundle)
      ZKLog.info("Imported identity (semaphore). commitment prefix: \(commitment.prefix(8))")
      return bundle
    #else
      let bundle = IdentityBundle(privateKey: privateKey, commitment: fallbackCommitment(from: privateKey))
      try keychain.storeIdentity(bundle)
      ZKLog.info("Imported identity (fallback). commitment prefix: \(bundle.commitment.prefix(8))")
      return bundle
    #endif
  }

  // MARK: - Proof helpers

  /// Generate a Semaphore proof JSON string for a message/scope within a group.
  /// Group members should be provided as commitments (hex/strings) including own commitment.
  func generateProof(groupCommitments: [String], message: String, scope: String, merkleDepth: Int = 16) throws -> String
  {
    #if canImport(Semaphore) && !(targetEnvironment(simulator) && arch(x86_64))
      guard let bundle = try? keychain.loadIdentity() else { throw Error.notInitialized }
      let canonicalMembers = Self.canonicalCommitments(groupCommitments + [bundle.commitment])
      guard canonicalMembers.count > 1 else {
        throw Error.insufficientGroupContext(
          "Semaphore proof generation requires at least 2 distinct group commitments."
        )
      }
      let identity = Identity(privateKey: bundle.privateKey)
      let memberElements = try canonicalMembers.map { try Self.commitmentElement(from: $0) }
      let group = Group(members: memberElements)
      guard let groupRootData = group.root() else {
        throw Error.groupConstructionFailed("Unable to derive group root from commitments.")
      }
      let groupRoot = Self.hexString(from: groupRootData)
      // The bindings expect arbitrary strings that are internally converted to field elements.
      // Avoid passing 64-char hex (which exceeds 32 bytes) — clamp to 32 UTF-8 bytes if needed.
      let normalizedMessage = Self.clampToMax32Bytes(message)
      let normalizedScope = Self.clampToMax32Bytes(scope)
      let rawProof = try generateSemaphoreProof(
        identity: identity,
        group: group,
        message: normalizedMessage,
        scope: normalizedScope,
        merkleTreeDepth: UInt16(merkleDepth)
      )
      let envelope = ProofEnvelope(
        version: 1,
        semaphoreProof: rawProof,
        groupRoot: groupRoot,
        signal: normalizedMessage,
        scope: normalizedScope,
        memberCount: canonicalMembers.count,
        commitments: canonicalMembers
      )
      let data = try JSONEncoder().encode(envelope)
      guard let encoded = String(bytes: data, encoding: .utf8) else {
        throw Error.groupConstructionFailed("Failed to encode semaphore proof envelope.")
      }
      return encoded
    #else
      throw Error.unsupported
    #endif
  }

  /// Verify a Semaphore proof JSON string.
  func verifyProof(
    _ proof: String,
    expectedRoot: String? = nil,
    expectedSignal: String? = nil,
    expectedScope: String? = nil
  ) throws -> Bool {
    let envelope = decodeEnvelope(from: proof)
    guard let envelope else { return false }

    let canonicalCommitments = Self.canonicalCommitments(envelope.commitments)

    if envelope.memberCount != canonicalCommitments.count {
      return false
    }

    if canonicalCommitments.count <= 1 {
      return false
    }

    #if canImport(Semaphore) && !(targetEnvironment(simulator) && arch(x86_64))
      let expectedEnvelopeRoot = try Self.circuitGroupRoot(for: canonicalCommitments)
      if envelope.groupRoot != expectedEnvelopeRoot { return false }
    #endif

    if let expectedRoot, envelope.groupRoot != expectedRoot { return false }
    if let expectedSignal, envelope.signal != Self.clampToMax32Bytes(expectedSignal) { return false }
    if let expectedScope, envelope.scope != Self.clampToMax32Bytes(expectedScope) { return false }

    let rawProof = envelope.semaphoreProof
    #if canImport(Semaphore) && !(targetEnvironment(simulator) && arch(x86_64))
      return try verifySemaphoreProof(proof: rawProof)
    #else
      return false
    #endif
  }

  static func deterministicGroupRoot(for commitments: [String]) -> String {
    let canonical = canonicalCommitments(commitments)
    let payload = canonical.joined(separator: "|")
    let digest = SHA256.hash(data: Data(payload.utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
  }

  static func bindingRoot(for commitments: [String]) -> String {
    #if canImport(Semaphore) && !(targetEnvironment(simulator) && arch(x86_64))
      if let root = try? circuitGroupRoot(for: commitments) {
        return root
      }
    #endif
    return deterministicGroupRoot(for: commitments)
  }

  static func clampForBinding(_ input: String) -> String {
    clampToMax32Bytes(input)
  }

  struct ProofBindingContext: Equatable {
    let groupRoot: String
    let signal: String
    let scope: String
    let commitments: [String]
  }

  func bindingContext(from proof: String) -> ProofBindingContext? {
    guard let envelope = decodeEnvelope(from: proof) else { return nil }
    return ProofBindingContext(
      groupRoot: envelope.groupRoot,
      signal: envelope.signal,
      scope: envelope.scope,
      commitments: envelope.commitments
    )
  }

  // MARK: - Utilities

  private func randomSecret32() -> Data {
    var bytes = [UInt8](repeating: 0, count: 32)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return Data(bytes)
  }

  /// Fallback commitment when Semaphore library is not present: SHA256 of secret bytes (hex)
  private func fallbackCommitment(from secret: Data) -> String {
    let digest = SHA256.hash(data: secret)
    return digest.map { String(format: "%02x", $0) }.joined()
  }

  private static func clampToMax32Bytes(_ input: String) -> String {
    let bytes = Array(input.utf8)
    if bytes.count <= 32 { return input }
    return String(data: Data(bytes.prefix(32)), encoding: .utf8) ?? ""
  }

  private static func canonicalCommitments(_ commitments: [String]) -> [String] {
    let normalized = commitments
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
    return Array(Set(normalized)).sorted()
  }

  #if canImport(Semaphore) && !(targetEnvironment(simulator) && arch(x86_64))
    private static func circuitGroupRoot(for commitments: [String]) throws -> String {
      let canonical = canonicalCommitments(commitments)
      let members = try canonical.map { try commitmentElement(from: $0) }
      let group = Group(members: members)
      guard let root = group.root() else {
        throw Error.groupConstructionFailed("Failed to obtain root for group commitments.")
      }
      return hexString(from: root)
    }
  #endif

  private static func commitmentElement(from commitment: String) throws -> Data {
    let normalized = commitment.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { throw Error.invalidCommitment("Commitment is empty.") }
    guard normalized.allSatisfy(\.isNumber) else {
      throw Error.invalidCommitment("Commitment must be a decimal field element string.")
    }
    return try decimalStringToLittleEndian32(normalized)
  }

  private static func decimalStringToLittleEndian32(_ value: String) throws -> Data {
    var bytes = [UInt8](repeating: 0, count: 32)
    for scalar in value.unicodeScalars {
      guard let digit = Int(String(scalar)) else {
        throw Error.invalidCommitment("Invalid decimal scalar in commitment.")
      }
      var carry = digit
      for index in 0..<bytes.count {
        let total = Int(bytes[index]) * 10 + carry
        bytes[index] = UInt8(total & 0xff)
        carry = total >> 8
      }
      if carry > 0 {
        throw Error.invalidCommitment("Commitment exceeds 256-bit field element size.")
      }
    }
    return Data(bytes)
  }

  private static func hexString(from data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }

  private func decodeEnvelope(from proof: String) -> ProofEnvelope? {
    guard let data = proof.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(ProofEnvelope.self, from: data)
  }

  private func ensureCommitment(bundle: IdentityBundle) -> IdentityBundle {
    guard bundle.commitment.isEmpty else { return bundle }
    #if canImport(Semaphore) && !(targetEnvironment(simulator) && arch(x86_64))
      let identity = Identity(privateKey: bundle.privateKey)
      let commitment = identity.commitment()
      return IdentityBundle(privateKey: bundle.privateKey, commitment: commitment)
    #else
      return IdentityBundle(privateKey: bundle.privateKey, commitment: fallbackCommitment(from: bundle.privateKey))
    #endif
  }
}

// MARK: - Keychain storage for identity

protocol IdentityBundleStore {
  func storeIdentity(_ bundle: SemaphoreIdentityManager.IdentityBundle) throws
  func loadIdentity() throws -> SemaphoreIdentityManager.IdentityBundle?
}

final class KeychainIdentityStore: IdentityBundleStore {
  private let tag: String
  private let legacyTag: String

  init(
    tag: String = AppBranding.currentSemaphoreIdentityTag,
    legacyTag: String = AppBranding.legacySemaphoreIdentityTag
  ) {
    self.tag = tag
    self.legacyTag = legacyTag
  }

  func storeIdentity(_ bundle: SemaphoreIdentityManager.IdentityBundle) throws {
    let data = try JSONEncoder().encode(bundle)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: tag,
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]
    SecItemDelete(query as CFDictionary)
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else { throw SemaphoreIdentityManager.Error.storageFailed("SecItemAdd: \(status)") }
  }

  func loadIdentity() throws -> SemaphoreIdentityManager.IdentityBundle? {
    if let current = try loadIdentity(for: tag) {
      return current
    }

    guard let legacy = try loadIdentity(for: legacyTag) else {
      return nil
    }

    try storeIdentity(legacy)
    return legacy
  }

  private func loadIdentity(for tag: String) throws -> SemaphoreIdentityManager.IdentityBundle? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: tag,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
      throw SemaphoreIdentityManager.Error.storageFailed("SecItemCopyMatching: \(status)")
    }
    return try JSONDecoder().decode(SemaphoreIdentityManager.IdentityBundle.self, from: data)
  }
}
