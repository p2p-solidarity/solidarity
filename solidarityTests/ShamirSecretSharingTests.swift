//
//  ShamirSecretSharingTests.swift
//  solidarityTests
//
//  Validates the corrected Shamir SSS implementation:
//  - prime is the NIST P-256 field prime (256 bits, prime, well-vetted)
//  - division is binary long division (no subtraction loop)
//  - split/combine round-trips for various secret sizes and (k, n) configurations
//

import XCTest
@testable import solidarity

final class ShamirSecretSharingTests: XCTestCase {

    // MARK: - Prime sanity

    func testPrimeIsP256FieldPrime() {
        let prime = ShamirSecretSharing.prime
        XCTAssertFalse(prime.isZero, "Prime must be non-zero")
        XCTAssertEqual(prime.bitWidth, 256, "P-256 field prime should be 256 bits")

        // 2^256 - 2^224 + 2^192 + 2^96 - 1 hex form
        let expected = BigUInt(hexString: "FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF")
        XCTAssertEqual(prime, expected)
    }

    func testPrimeNotEqualToOldComposite() {
        let oldComposite = BigUInt(hexString: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")
        XCTAssertNotEqual(ShamirSecretSharing.prime, oldComposite)
    }

    // MARK: - BigUInt division

    func testBigUIntDivisionMatchesUInt64() {
        let cases: [(UInt64, UInt64)] = [
            (1, 1), (10, 3), (1_000_000, 7), (UInt64.max, 2),
            (UInt64.max, UInt64.max), (12345, 100), (0, 5)
        ]
        for (a, b) in cases {
            let big = BigUInt(a) / BigUInt(b)
            let mod = BigUInt(a) % BigUInt(b)
            XCTAssertEqual(big, BigUInt(a / b), "div mismatch for \(a)/\(b)")
            XCTAssertEqual(mod, BigUInt(a % b), "mod mismatch for \(a)%\(b)")
        }
    }

    func testBigUIntDivisionLargeValues() {
        let prime = ShamirSecretSharing.prime
        let a = prime - BigUInt(1)
        let b = BigUInt(7)
        let q = a / b
        let r = a % b
        // Reconstruct and check q*b + r == a
        XCTAssertEqual(q * b + r, a)
        XCTAssertTrue(r < b)
    }

    // MARK: - Shamir round-trip

    func testSplitCombineRoundTripSmallSecret() throws {
        let secret = Data([0x42, 0xDE, 0xAD, 0xBE, 0xEF])
        let shares = try ShamirSecretSharing.split(secret: secret, threshold: 3, totalShares: 5)
        XCTAssertEqual(shares.count, 5)

        let reconstructed = try ShamirSecretSharing.combine(shares: Array(shares.prefix(3)))
        XCTAssertEqual(reconstructed, secret)
    }

    func testSplitCombineRoundTripFullSecret() throws {
        // 32-byte secret with leading non-zero byte so serialize round-trips bit-for-bit.
        // Value must be below the P-256 prime.
        var bytes = [UInt8](repeating: 0, count: 32)
        bytes[0] = 0x7F
        for i in 1..<32 {
            bytes[i] = UInt8(i & 0xFF)
        }
        let secret = Data(bytes)

        let shares = try ShamirSecretSharing.split(secret: secret, threshold: 3, totalShares: 5)
        let reconstructed = try ShamirSecretSharing.combine(shares: Array(shares.prefix(3)))
        XCTAssertEqual(reconstructed, secret)
    }

    func testSplitCombineWithDifferentShareSubsets() throws {
        let secret = Data([0xCA, 0xFE, 0xBA, 0xBE, 0x12, 0x34])
        let shares = try ShamirSecretSharing.split(secret: secret, threshold: 3, totalShares: 5)

        // Subset 1: first 3
        let r1 = try ShamirSecretSharing.combine(shares: [shares[0], shares[1], shares[2]])
        XCTAssertEqual(r1, secret)

        // Subset 2: last 3
        let r2 = try ShamirSecretSharing.combine(shares: [shares[2], shares[3], shares[4]])
        XCTAssertEqual(r2, secret)

        // Subset 3: skip-around
        let r3 = try ShamirSecretSharing.combine(shares: [shares[0], shares[2], shares[4]])
        XCTAssertEqual(r3, secret)
    }

    func testCombineWithFewerThanThresholdFails() throws {
        let secret = Data([0x01, 0x02, 0x03])
        let shares = try ShamirSecretSharing.split(secret: secret, threshold: 3, totalShares: 5)

        XCTAssertThrowsError(try ShamirSecretSharing.combine(shares: Array(shares.prefix(2)))) { error in
            guard case ShamirError.insufficientShares = error else {
                XCTFail("Expected insufficientShares, got \(error)")
                return
            }
        }
    }

    func testCorruptedShareDetected() throws {
        let secret = Data([0xAA, 0xBB])
        let shares = try ShamirSecretSharing.split(secret: secret, threshold: 2, totalShares: 3)
        var corrupted = shares
        // Mutate the share value but keep the (now invalid) checksum.
        var v = corrupted[0].value
        v[0] ^= 0xFF
        corrupted[0] = SecretShare(
            index: corrupted[0].index,
            value: v,
            threshold: corrupted[0].threshold,
            totalShares: corrupted[0].totalShares,
            checksum: corrupted[0].checksum
        )
        XCTAssertThrowsError(try ShamirSecretSharing.combine(shares: Array(corrupted.prefix(2))))
    }
}

// MARK: - File encryption

final class FileEncryptionPerChunkNonceTests: XCTestCase {

    func testEncryptDecryptRoundTripMultiChunk() async throws {
        // Force more than one chunk: bufferSize is 1 MiB, so use 2.5 MiB.
        let bytes = (0..<(2_500_000)).map { UInt8($0 & 0xFF) }
        let plaintext = Data(bytes)

        let temp = FileManager.default.temporaryDirectory
        let src = temp.appendingPathComponent("vault-src-\(UUID().uuidString).bin")
        let enc = temp.appendingPathComponent("vault-enc-\(UUID().uuidString).bin")
        let dec = temp.appendingPathComponent("vault-dec-\(UUID().uuidString).bin")
        defer {
            try? FileManager.default.removeItem(at: src)
            try? FileManager.default.removeItem(at: enc)
            try? FileManager.default.removeItem(at: dec)
        }

        try plaintext.write(to: src)

        _ = try await FileEncryptionService.shared.encryptFile(at: src, to: enc)
        try await FileEncryptionService.shared.decryptFile(at: enc, to: dec)

        let decrypted = try Data(contentsOf: dec)
        XCTAssertEqual(decrypted, plaintext)

        // Confirm the encrypted file starts with the v2 magic header.
        let encRaw = try Data(contentsOf: enc)
        XCTAssertGreaterThanOrEqual(encRaw.count, 4)
        XCTAssertEqual(Array(encRaw.prefix(4)), [0x00, 0x00, 0x00, 0x02])
    }

    func testRejectsLegacyOrUnknownFormat() async throws {
        let temp = FileManager.default.temporaryDirectory
        let bogus = temp.appendingPathComponent("bogus-\(UUID().uuidString).bin")
        let out = temp.appendingPathComponent("bogus-out-\(UUID().uuidString).bin")
        defer {
            try? FileManager.default.removeItem(at: bogus)
            try? FileManager.default.removeItem(at: out)
        }
        // Random bytes without the v2 header.
        try Data([0xAA, 0xBB, 0xCC, 0xDD, 0xEE]).write(to: bogus)

        do {
            try await FileEncryptionService.shared.decryptFile(at: bogus, to: out)
            XCTFail("Expected unsupportedFileVersion error")
        } catch let error as VaultError {
            guard case .unsupportedFileVersion = error else {
                XCTFail("Expected unsupportedFileVersion, got \(error)")
                return
            }
        }
    }
}
