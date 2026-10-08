//
//  SemaphoreShim.swift
//  @solidarity/nitro-semaphore (iOS)
//
//  Bridges the semaphore-rs uniffi Swift wrapper (`mopro.swift` inside the
//  sibling `SemaphoreBindings` pod) into the Semaphore Swift module.
//  `@_implementationOnly import SemaphoreBindings` hides uniffi's internal
//  types (RustBuffer, Identity, Group, FfiConverter…) from the
//  HybridSemaphoreSpec Swift→C++ interop header that Nitro generates.
//
//  We MUST mirror SemaphoreIdentityManager.swift's field-element encoding
//  exactly so commitments produced by the Expo Nitro module match
//  commitments produced by the SwiftUI legacy app. The two important
//  helpers ported here are:
//
//    decimalStringToLittleEndian32 — parse a decimal-string field element
//      into a 32-byte little-endian Data (the form the Rust binding
//      expects for `Group::new(members:)`).
//
//    clampToMax32Bytes — UTF-8 byte-truncate the scope/signal so the
//      binding's max-32-bytes precondition is respected.
//
//  See solidarity/Services/ZK/SemaphoreIdentityManager.swift:427-453 for
//  the gold reference; any change here MUST keep that file in sync.
//
import Foundation
@_implementationOnly import SemaphoreBindings

/// Decoded view of a semaphore-rs proof JSON. Mirrors the keys produced
/// by `semaphore_bindings::generate_semaphore_proof` (snake_case, with
/// `points` as an array of decimal-string field elements).
internal struct ShimProofParts {
  let merkleTreeDepth: UInt16
  let merkleRoot: String
  let nullifier: String
  let message: String
  let scope: String
  let points: String   // raw JSON sub-blob, kept verbatim
}

internal enum SemaphoreShim {

  // MARK: - Identity lifecycle

  /// Build a fresh Identity from `secretBytes` (must be 32 bytes).
  /// Returns the public commitment as a decimal-string field element.
  static func makeIdentity(secret: Data) -> (commitment: String, identity: Identity) {
    let identity = Identity(privateKey: secret)
    return (identity.commitment(), identity)
  }

  /// Re-derive an Identity from a previously-stored private-key blob.
  /// Identical to `makeIdentity` but named to match the call-site intent
  /// (load vs create) — the Rust binding has no separate "load" step.
  static func loadIdentity(privateKey: Data) -> Identity {
    Identity(privateKey: privateKey)
  }

  /// Extract the raw 32-byte private key bytes from an Identity. Used
  /// for "Export Private Key" + Keychain persistence.
  static func privateKeyBytes(of identity: Identity) -> Data {
    identity.privateKey()
  }

  // MARK: - Group root

  /// Compute the Semaphore-circuit group root for the given commitments
  /// (DECIMAL-STRING field elements). The caller MUST have canonicalised
  /// the list (trim, dedupe, sort) before calling — we don't re-do that
  /// here so the implementation matches Swift's existing
  /// `SemaphoreIdentityManager.circuitGroupRoot`.
  ///
  /// Returns the root as a DECIMAL-STRING field element so it round-trips
  /// through Codable + matches the Swift surface.
  static func groupRoot(commitments: [String]) throws -> String {
    let elements = try commitments.map { try commitmentElement(from: $0) }
    let group = Group(members: elements)
    guard let rootBytes = group.root() else {
      throw SemaphoreError.groupRootMissing
    }
    return decimalString(fromLittleEndian32: rootBytes)
  }

  /// Index of `commitment` inside the canonicalised member set, or nil.
  static func indexOf(commitment: String, in commitments: [String]) throws -> Int? {
    let elements = try commitments.map { try commitmentElement(from: $0) }
    let group = Group(members: elements)
    let needle = try commitmentElement(from: commitment)
    if let idx = group.indexOf(member: needle) {
      return Int(idx)
    }
    return nil
  }

  // MARK: - Proof generation / verification

  static func generateProof(
    identity: Identity,
    groupCommitments: [String],
    message: String,
    scope: String,
    merkleTreeDepth: UInt16
  ) throws -> ShimProofParts {
    let elements = try groupCommitments.map { try commitmentElement(from: $0) }
    let group = Group(members: elements)
    let normalizedMessage = clampToMax32Bytes(message)
    let normalizedScope = clampToMax32Bytes(scope)
    let proofJSON = try generateSemaphoreProof(
      identity: identity,
      group: group,
      message: normalizedMessage,
      scope: normalizedScope,
      merkleTreeDepth: merkleTreeDepth
    )
    return try parseProofJSON(proofJSON,
                              fallbackScope: normalizedScope,
                              fallbackSignal: normalizedMessage,
                              depth: merkleTreeDepth)
  }

  static func verifyProof(rawJSON: String) throws -> Bool {
    return try verifySemaphoreProof(proof: rawJSON)
  }

  // MARK: - Internal helpers (mirrors SemaphoreIdentityManager.swift)

  /// Trim, dedupe, sort the commitments. KEEP IN SYNC with
  /// SemaphoreIdentityManager.swift:408-413.
  static func canonicalCommitments(_ commitments: [String]) -> [String] {
    let normalized = commitments
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
    return Array(Set(normalized)).sorted()
  }

  /// UTF-8 truncate to 32 bytes. KEEP IN SYNC with
  /// SemaphoreIdentityManager.swift:402-406.
  static func clampToMax32Bytes(_ input: String) -> String {
    let bytes = Array(input.utf8)
    if bytes.count <= 32 { return input }
    return String(data: Data(bytes.prefix(32)), encoding: .utf8) ?? ""
  }

  /// Decimal string → 32-byte little-endian Data. KEEP IN SYNC with
  /// SemaphoreIdentityManager.swift:436-453.
  ///
  /// The Rust binding expects `Vec<u8>` of exactly 32 bytes in
  /// little-endian order representing the scalar (the binding feeds it
  /// to `Field::from_le_bytes_mod_order`). Direct hex slicing would
  /// silently truncate values that fit in <64 hex chars; this implementation
  /// performs schoolbook decimal-to-bytes so the result is bit-identical
  /// to the Swift original.
  static func commitmentElement(from commitment: String) throws -> Data {
    let normalized = commitment.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { throw SemaphoreError.invalidCommitment("empty") }
    guard normalized.allSatisfy(\.isNumber) else {
      throw SemaphoreError.invalidCommitment("non-decimal")
    }
    return try decimalStringToLittleEndian32(normalized)
  }

  static func decimalStringToLittleEndian32(_ value: String) throws -> Data {
    var bytes = [UInt8](repeating: 0, count: 32)
    for scalar in value.unicodeScalars {
      guard let digit = Int(String(scalar)) else {
        throw SemaphoreError.invalidCommitment("invalid scalar")
      }
      var carry = digit
      for index in 0..<bytes.count {
        let total = Int(bytes[index]) * 10 + carry
        bytes[index] = UInt8(total & 0xff)
        carry = total >> 8
      }
      if carry > 0 {
        throw SemaphoreError.invalidCommitment("exceeds 256-bit field element")
      }
    }
    return Data(bytes)
  }

  /// Inverse of `decimalStringToLittleEndian32`: 32-byte LE → decimal string.
  /// Used to surface group roots / nullifiers in the same form the legacy
  /// Swift Codable layer emits.
  static func decimalString(fromLittleEndian32 data: Data) -> String {
    var digits: [UInt8] = [0]
    for byte in data.reversed() {
      // result = result * 256 + byte
      var carry = UInt32(byte)
      for i in 0..<digits.count {
        let total = UInt32(digits[i]) * 256 + carry
        digits[i] = UInt8(total % 10)
        carry = total / 10
      }
      while carry > 0 {
        digits.append(UInt8(carry % 10))
        carry /= 10
      }
    }
    let trimmed = digits.reversed().drop(while: { $0 == 0 })
    if trimmed.isEmpty { return "0" }
    return String(trimmed.map { Character("\($0)") })
  }

  // MARK: - Proof JSON parsing
  //
  // semaphore_bindings emits a JSON object shaped like:
  //   {
  //     "merkle_tree_depth": 16,
  //     "merkle_tree_root":  "12345678901234567890",
  //     "nullifier":         "98765432109876543210",
  //     "message":           "scope-clamped",
  //     "scope":             "scope-clamped",
  //     "points":            ["1","2","3","4","5","6","7","8"]
  //   }
  // Some upstream versions use snake_case; older builds also tolerate
  // camelCase. We accept both — SemaphoreIdentityManager.swift's
  // `extractStringField` does the same.
  private static func parseProofJSON(
    _ raw: String,
    fallbackScope: String,
    fallbackSignal: String,
    depth: UInt16
  ) throws -> ShimProofParts {
    guard let data = raw.data(using: .utf8) else {
      throw SemaphoreError.proofParseFailed("not utf-8")
    }
    guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw SemaphoreError.proofParseFailed("not a JSON object")
    }
    let root = stringField(obj, ["merkle_tree_root", "merkleTreeRoot"]) ?? ""
    let nullifier = stringField(obj, ["nullifier", "nullifierHash"]) ?? ""
    let scope = stringField(obj, ["scope"]) ?? fallbackScope
    let message = stringField(obj, ["message", "signal"]) ?? fallbackSignal
    let depthFound = uint16Field(obj, ["merkle_tree_depth", "merkleTreeDepth"]) ?? depth
    var pointsJSON = "[]"
    if let pointsAny = obj["points"] {
      let pointsData = try JSONSerialization.data(withJSONObject: pointsAny)
      pointsJSON = String(data: pointsData, encoding: .utf8) ?? "[]"
    }
    return ShimProofParts(
      merkleTreeDepth: depthFound,
      merkleRoot: root,
      nullifier: nullifier,
      message: message,
      scope: scope,
      points: pointsJSON
    )
  }

  private static func stringField(_ obj: [String: Any], _ keys: [String]) -> String? {
    for k in keys {
      if let v = obj[k] as? String, !v.isEmpty { return v }
      if let n = obj[k] as? NSNumber { return n.stringValue }
    }
    return nil
  }

  private static func uint16Field(_ obj: [String: Any], _ keys: [String]) -> UInt16? {
    for k in keys {
      if let n = obj[k] as? NSNumber { return n.uint16Value }
    }
    return nil
  }
}

internal enum SemaphoreError: Swift.Error, LocalizedError {
  case invalidCommitment(String)
  case groupRootMissing
  case proofParseFailed(String)
  case identityNotLoaded

  var errorDescription: String? {
    switch self {
    case .invalidCommitment(let reason): return "invalid commitment: \(reason)"
    case .groupRootMissing: return "group root missing"
    case .proofParseFailed(let reason): return "proof JSON parse failed: \(reason)"
    case .identityNotLoaded: return "no identity loaded"
    }
  }
}
