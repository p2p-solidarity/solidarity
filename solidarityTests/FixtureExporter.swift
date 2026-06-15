//
//  FixtureExporter.swift
//  solidarityTests
//
//  Exports golden JSON fixtures consumed by the Expo bun-test parity suite
//  in apps/expo/__tests__/parity/. Each test below pins a deterministic
//  (key, nonce, plaintext) → ciphertext mapping so the TS port can prove
//  byte-equal output across CryptoKit ↔ @noble/ciphers.
//
//  Run:
//    xcodebuild test \
//      -project solidarity.xcodeproj \
//      -scheme solidarity \
//      -only-testing solidarityTests/FixtureExporter \
//      -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
//      -skipPackagePluginValidation
//
//  Or via the convenience helper:
//    scripts/export_parity_fixtures.sh
//
//  Writes to: ../packages/parity-fixtures/fixtures/<domain>/<case>.json
//

import CryptoKit
import Foundation
import XCTest

@testable import solidarity

#if canImport(Semaphore) && !(targetEnvironment(simulator) && arch(x86_64))
  import Semaphore
#endif

final class FixtureExporter: XCTestCase {

  // MARK: - Public exports

  /// AES-256-GCM round trip — proves Swift CryptoKit ↔ TS @noble/ciphers
  /// produce byte-equal `nonce || ciphertext || tag` blobs.
  func test_exportAesGcmRoundTrip() throws {
    let cases: [AesGcmFixture] = [
      .init(
        name: "empty_string",
        keyHex: String(repeating: "00", count: 32),
        nonceHex: String(repeating: "00", count: 12),
        plaintext: ""
      ),
      .init(
        name: "hello_world",
        keyHex: String(repeating: "0102030405060708", count: 4),
        nonceHex: String(repeating: "0a", count: 12),
        plaintext: "Hello, Solidarity!"
      ),
      .init(
        name: "business_card_json",
        keyHex: "aabbccddeeff00112233445566778899" +
                "aabbccddeeff00112233445566778899",
        nonceHex: "112233445566778899aabbcc",
        plaintext: #"{"id":"00000000-0000-0000-0000-000000000001","name":"Alice"}"#
      ),
      .init(
        name: "long_payload_1kb",
        keyHex: String(repeating: "ff", count: 32),
        nonceHex: String(repeating: "01", count: 12),
        plaintext: String(repeating: "🦊", count: 256)  // 1024 UTF-8 bytes
      ),
    ]

    var encoded: [[String: String]] = []
    for fix in cases {
      let key = SymmetricKey(data: Data(hexString: fix.keyHex))
      let nonce = try AES.GCM.Nonce(data: Data(hexString: fix.nonceHex))
      guard let ptData = fix.plaintext.data(using: .utf8) else {
        XCTFail("plaintext for case '\(fix.name)' is not valid UTF-8")
        continue
      }
      let sealed = try AES.GCM.seal(ptData, using: key, nonce: nonce)
      guard let combined = sealed.combined else {
        XCTFail("AES.GCM.SealedBox.combined returned nil for '\(fix.name)'")
        continue
      }
      encoded.append([
        "name": fix.name,
        "key": fix.keyHex,
        "nonce": fix.nonceHex,
        "plaintext": fix.plaintext,
        "ciphertext": combined.hexString,
      ])
    }

    try writeFixture(domain: "encryption", file: "aes_gcm_round_trip.json", payload: [
      "schema": "1",
      "source": "solidarityTests/FixtureExporter.test_exportAesGcmRoundTrip",
      "cases": encoded,
    ])
  }

  /// QR chunking — exports a payload + Swift-produced frame list so the TS
  /// reassembler asserts byte-equal payload reconstruction.
  func test_exportQrChunkFrames() throws {
    let payloads: [(String, String, Int)] = [
      ("short_string", "Hello, Solidarity!", QRCodeChunkingService.defaultChunkDataBytes),
      ("multiline_vc", String(repeating: "abcdef0123456789\n", count: 200),
       QRCodeChunkingService.defaultChunkDataBytes),
      ("tiny_chunks", String(repeating: "a", count: 4096), QRCodeChunkingService.minChunkDataBytes),
    ]

    var cases: [[String: Any]] = []
    for (name, payload, chunkBytes) in payloads {
      let frames = try QRCodeChunkingService.makeFrames(for: payload, chunkDataBytes: chunkBytes)
      cases.append([
        "name": name,
        "payload": payload,
        "chunkBytes": chunkBytes,
        "frames": frames,
      ])
    }

    try writeFixture(domain: "qr", file: "chunking_round_trip.json", payload: [
      "schema": "1",
      "source": "solidarityTests/FixtureExporter.test_exportQrChunkFrames",
      "cases": cases,
    ])
  }

  /// ES256 JWT sign — proves Swift CryptoKit signatures verify under the TS
  /// `@noble/curves` implementation. Signatures are randomised (CryptoKit
  /// uses a fresh `k` per call), so byte-equal is NOT asserted; the TS side
  /// recomputes the JWS and runs verify(pubkey, message, signature).
  func test_exportEs256JwtSignature() throws {
    // Fixed 32-byte private scalar (NOT random) so the test is reproducible
    // across machines. Pubkey + DID derive deterministically from this.
    let privHex = "11111111222222223333333344444444" +
                  "55555555666666667777777788888888"
    let priv = try P256.Signing.PrivateKey(rawRepresentation: Data(hexString: privHex))
    let pubX963 = priv.publicKey.x963Representation

    let headerJson = #"{"alg":"ES256","typ":"JWT"}"#
    let payloadJson = #"{"sub":"solidarity-fixture","iat":1700000000}"#

    let headerB64 = base64URL(Data(headerJson.utf8))
    let payloadB64 = base64URL(Data(payloadJson.utf8))
    let signingInput = "\(headerB64).\(payloadB64)"

    let sig = try priv.signature(for: Data(signingInput.utf8))
    let jwt = "\(signingInput).\(base64URL(sig.rawRepresentation))"

    try writeFixture(domain: "identity", file: "es256_jwt.json", payload: [
      "schema": "1",
      "source": "solidarityTests/FixtureExporter.test_exportEs256JwtSignature",
      "cases": [[
        "name": "fixed_seed_keypair",
        "privKeyHex": privHex,
        "publicKeyX963Hex": pubX963.hexString,
        "headerJson": headerJson,
        "payloadJson": payloadJson,
        "jwt": jwt,
      ]],
    ])
  }

  /// Semaphore identity commitments — pins the Pedersen-hash output the
  /// Rust `semaphore_bindings` crate produces for fixed seeds. The
  /// Expo Nitro module MUST produce the same commitments otherwise
  /// every group's local merkle root drifts away from the legacy
  /// SwiftUI app's view. Runs only on arm64 simulators / devices where
  /// the Semaphore SPM package is linkable.
  func test_exportSemaphoreIdentityCommitments() throws {
    #if canImport(Semaphore) && !(targetEnvironment(simulator) && arch(x86_64))
      struct Seed { let name: String; let hex: String }
      let seeds: [Seed] = [
        .init(name: "all_zeros",       hex: String(repeating: "00", count: 32)),
        .init(name: "all_ones",        hex: String(repeating: "01", count: 32)),
        .init(name: "ascending",       hex: (0..<32).map { String(format: "%02x", $0) }.joined()),
        .init(name: "kidneyweakx_fixture",
              hex: "11111111222222223333333344444444" +
                   "55555555666666667777777788888888"),
      ]

      var commitmentCases: [[String: Any]] = []
      var allCommitments: [String] = []
      for seed in seeds {
        let bytes = Data(hexString: seed.hex)
        let identity = Identity(privateKey: bytes)
        let commitment = identity.commitment()
        commitmentCases.append([
          "name": seed.name,
          "privateKeyHex": seed.hex,
          "commitment": commitment,
        ])
        allCommitments.append(commitment)
      }
      try writeFixture(domain: "semaphore", file: "identity_commitments.json", payload: [
        "schema": "1",
        "source": "solidarityTests/FixtureExporter.test_exportSemaphoreIdentityCommitments",
        "cases": commitmentCases,
      ])

      // Cross-fixture: group root over the four seed identities (canonical
      // sorted dedupe) so the TS port can verify it computes the same root.
      let trimmed = allCommitments
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
      let canonical = Array(Set(trimmed)).sorted()
      let elements: [Data] = try canonical.map { commitment in
        var bytes = [UInt8](repeating: 0, count: 32)
        for scalar in commitment.unicodeScalars {
          guard let digit = Int(String(scalar)) else { throw NSError(domain: "fx", code: 1) }
          var carry = digit
          for i in 0..<bytes.count {
            let total = Int(bytes[i]) * 10 + carry
            bytes[i] = UInt8(total & 0xff)
            carry = total >> 8
          }
        }
        return Data(bytes)
      }
      let group = Group(members: elements)
      guard let rootData = group.root() else {
        XCTFail("group root missing")
        return
      }
      // Decode 32-byte LE root → decimal string (same as the Nitro module).
      var digits: [UInt8] = [0]
      for byte in rootData.reversed() {
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
      let trimmedDigits = digits.reversed().drop(while: { $0 == 0 })
      let rootDecimal = trimmedDigits.isEmpty ? "0" :
        String(trimmedDigits.map { Character("\($0)") })

      try writeFixture(domain: "semaphore", file: "group_root.json", payload: [
        "schema": "1",
        "source": "solidarityTests/FixtureExporter.test_exportSemaphoreIdentityCommitments",
        "canonicalCommitments": canonical,
        "rootDecimal": rootDecimal,
      ])
    #else
      throw XCTSkip("Semaphore not linkable in this build (x86_64 simulator)")
    #endif
  }

  /// JSON-encoded `BusinessCard` round trip — pins the Codable byte layout
  /// so the Zod port asserts the same field order/types.
  func test_exportBusinessCardJsonRoundTrip() throws {
    let card = BusinessCard(
      id: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
      name: "Ada Lovelace",
      title: "Founder",
      company: "Solidarity",
      email: "ada@solidarity.gg",
      phone: nil,
      profileImage: nil,
      animal: .sheep,
      socialNetworks: [],
      skills: [],
      categories: ["engineering"],
      sharingPreferences: SharingPreferences(
        publicFields: [.name, .title],
        professionalFields: [.name, .title, .company, .email],
        personalFields: [.name, .email, .phone],
        allowForwarding: true,
        expirationDate: nil,
        useZK: false,
        sharingFormat: .didSigned
      ),
      groupContext: nil,
      verifiedFields: nil,
      nameType: .displayName,
      createdAt: Date(timeIntervalSince1970: 1_700_000_000),
      updatedAt: Date(timeIntervalSince1970: 1_700_000_000)
    )

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    encoder.dateEncodingStrategy = .secondsSince1970
    let data = try encoder.encode(card)
    let json = String(data: data, encoding: .utf8) ?? ""

    try writeFixture(domain: "types", file: "business_card_round_trip.json", payload: [
      "schema": "1",
      "source": "solidarityTests/FixtureExporter.test_exportBusinessCardJsonRoundTrip",
      "json": json,
    ])
  }

  // MARK: - File output helper

  /// `<repo-root>/packages/parity-fixtures/fixtures` regardless of which
  /// Xcode scheme / derived-data path the test runs from. `#filePath` is
  /// resolved at compile time to this source file's absolute path.
  private var fixtureRoot: URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // solidarityTests/
      .deletingLastPathComponent()  // airmeishi/
      .appendingPathComponent("packages/parity-fixtures/fixtures", isDirectory: true)
  }

  private func writeFixture(domain: String, file: String, payload: Any) throws {
    let dir = fixtureRoot.appendingPathComponent(domain, isDirectory: true)
    try FileManager.default.createDirectory(
      at: dir,
      withIntermediateDirectories: true
    )
    let url = dir.appendingPathComponent(file)
    let data = try JSONSerialization.data(
      withJSONObject: payload,
      options: [.prettyPrinted, .sortedKeys]
    )
    try data.write(to: url, options: .atomic)
    print("📝 wrote fixture: \(url.path)")
  }
}

// MARK: - Fixture struct

private struct AesGcmFixture {
  let name: String
  let keyHex: String
  let nonceHex: String
  let plaintext: String
}

/// RFC 4648 base64url (url-safe, no padding) — local helper.
private func base64URL(_ data: Data) -> String {
  data.base64EncodedString()
    .replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}

// MARK: - Hex helpers (test-local; do NOT leak into production code)

private extension Data {
  init(hexString: String) {
    let chars = Array(hexString.lowercased())
    precondition(chars.count % 2 == 0, "hex string must have even length")
    var bytes: [UInt8] = []
    bytes.reserveCapacity(chars.count / 2)
    for i in stride(from: 0, to: chars.count, by: 2) {
      let s = "\(chars[i])\(chars[i + 1])"
      guard let byte = UInt8(s, radix: 16) else {
        preconditionFailure("invalid hex byte \(s)")
      }
      bytes.append(byte)
    }
    self.init(bytes)
  }

  var hexString: String {
    map { String(format: "%02x", $0) }.joined()
  }
}
