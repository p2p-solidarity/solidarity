//
//  ShamirSecretSharing.swift
//  airmeishi
//
//  Shamir Secret Sharing implementation for The Sovereign Vault
//  Used for digital inheritance and emergency key recovery
//

import Foundation
import CryptoKit

// MARK: - Shamir Secret Sharing

/// Implementation of Shamir's (k, n) Secret Sharing Scheme
/// Allows splitting a secret into n shares where any k shares can reconstruct it
final class ShamirSecretSharing {

    /// The prime field modulus (256-bit prime for key-size secrets)
    /// Using a Mersenne-like prime for efficient arithmetic
    private static let prime: BigUInt = BigUInt("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF") ?? BigUInt(0)

    // MARK: - Public API

    /// Split a secret into n shares with threshold k
    /// - Parameters:
    ///   - secret: The secret data to split (max 32 bytes for AES-256 key)
    ///   - threshold: Minimum shares needed to reconstruct (k)
    ///   - totalShares: Total number of shares to create (n)
    /// - Returns: Array of shares
    static func split(
        secret: Data,
        threshold: Int,
        totalShares: Int
    ) throws -> [SecretShare] {
        guard threshold >= 2 else {
            throw ShamirError.thresholdTooLow
        }
        guard threshold <= totalShares else {
            throw ShamirError.thresholdExceedsTotalShares
        }
        guard totalShares <= 255 else {
            throw ShamirError.tooManyShares
        }
        guard secret.count <= 32 else {
            throw ShamirError.secretTooLarge
        }

        // Convert secret to BigUInt
        let secretInt = BigUInt(secret)

        // Generate k-1 random coefficients for the polynomial
        var coefficients = [secretInt]
        for _ in 1..<threshold {
            let randomBytes = (0..<32).map { _ in UInt8.random(in: 0...255) }
            let coeff = BigUInt(Data(randomBytes)) % prime
            coefficients.append(coeff)
        }

        // Evaluate polynomial at x = 1, 2, ..., n
        var shares: [SecretShare] = []
        for x in 1...totalShares {
            let y = evaluatePolynomial(coefficients: coefficients, x: BigUInt(x), prime: prime)

            let share = SecretShare(
                index: x,
                value: y.serialize(),
                threshold: threshold,
                totalShares: totalShares,
                checksum: computeShareChecksum(index: x, value: y.serialize())
            )
            shares.append(share)
        }

        return shares
    }

    /// Reconstruct secret from k or more shares
    /// - Parameter shares: Array of shares (must have at least threshold shares)
    /// - Returns: The reconstructed secret
    static func combine(shares: [SecretShare]) throws -> Data {
        guard !shares.isEmpty else {
            throw ShamirError.noShares
        }

        let threshold = shares[0].threshold
        guard shares.count >= threshold else {
            throw ShamirError.insufficientShares(have: shares.count, need: threshold)
        }

        // Verify all shares have matching parameters
        guard shares.allSatisfy({ $0.threshold == threshold && $0.totalShares == shares[0].totalShares }) else {
            throw ShamirError.incompatibleShares
        }

        // Verify checksums
        for share in shares {
            let expectedChecksum = computeShareChecksum(index: share.index, value: share.value)
            guard share.checksum == expectedChecksum else {
                throw ShamirError.corruptedShare(index: share.index)
            }
        }

        // Take only threshold shares for reconstruction
        let usedShares = Array(shares.prefix(threshold))

        // Lagrange interpolation at x = 0
        var secret = BigUInt(0)

        for i in 0..<threshold {
            let xi = BigUInt(usedShares[i].index)
            let yi = BigUInt(usedShares[i].value)

            var numerator = BigUInt(1)
            var denominator = BigUInt(1)

            for j in 0..<threshold where i != j {
                let xj = BigUInt(usedShares[j].index)
                numerator = (numerator * xj) % prime
                denominator = (denominator * ((xj + prime - xi) % prime)) % prime
            }

            // Lagrange basis polynomial
            let lagrange = (yi * numerator % prime) * modInverse(denominator, prime) % prime
            secret = (secret + lagrange) % prime
        }

        return secret.serialize()
    }

    // MARK: - Private Helpers

    private static func evaluatePolynomial(coefficients: [BigUInt], x: BigUInt, prime: BigUInt) -> BigUInt {
        var result = BigUInt(0)
        var power = BigUInt(1)

        for coeff in coefficients {
            result = (result + (coeff * power) % prime) % prime
            power = (power * x) % prime
        }

        return result
    }

    private static func modInverse(_ a: BigUInt, _ m: BigUInt) -> BigUInt {
        // Extended Euclidean Algorithm
        extendedGCD(a, m).1
    }

    private static func extendedGCD(_ a: BigUInt, _ b: BigUInt) -> (BigUInt, BigUInt) {
        if a.isZero {
            return (b, BigUInt(0))
        }
        let (g, x) = extendedGCD(b % a, a)
        return (g, (b / a * x + prime - x) % prime)
    }

    private static func computeShareChecksum(index: Int, value: Data) -> String {
        var data = Data()
        data.append(UInt8(index))
        data.append(value)
        let hash = SHA256.hash(data: data)
        return hash.prefix(4).compactMap { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Secret Share

struct SecretShare: Codable, Identifiable, Equatable {
    var id: Int { index }
    let index: Int
    let value: Data
    let threshold: Int
    let totalShares: Int
    let checksum: String

    /// Encode share for transmission (URL-safe base64)
    var encoded: String {
        let data = try? JSONEncoder().encode(self)
        return data?.base64EncodedString() ?? ""
    }

    /// Decode share from transmission format
    static func decode(from string: String) throws -> SecretShare {
        guard let data = Data(base64Encoded: string) else {
            throw ShamirError.invalidShareEncoding
        }
        return try JSONDecoder().decode(SecretShare.self, from: data)
    }
}

// MARK: - BigUInt (Lightweight implementation for secret sharing)

/// Lightweight arbitrary-precision unsigned integer for Shamir calculations
struct BigUInt: Equatable, Comparable {
    private var limbs: [UInt64]

    init(_ value: UInt64 = 0) {
        self.limbs = value == 0 ? [] : [value]
    }

    init(_ value: Int) {
        self.init(UInt64(value))
    }

    var isZero: Bool {
        limbs.isEmpty
    }

    init(_ data: Data) {
        var limbs: [UInt64] = []
        var current: UInt64 = 0
        var bits = 0

        for byte in data.reversed() {
            current |= UInt64(byte) << bits
            bits += 8
            if bits >= 64 {
                limbs.append(current)
                current = UInt64(byte) >> (8 - (bits - 64))
                bits -= 64
            }
        }

        if bits > 0 || current > 0 {
            limbs.append(current)
        }

        // Remove trailing zeros
        while limbs.last == 0 {
            limbs.removeLast()
        }

        self.limbs = limbs
    }

    init?(_ hexString: String) {
        guard let data = Data(hexString: hexString) else {
            return nil
        }
        self.init(data)
    }

    func serialize() -> Data {
        var data = Data()
        for limb in limbs.reversed() {
            for i in (0..<8).reversed() {
                let byte = UInt8((limb >> (i * 8)) & 0xFF)
                if !data.isEmpty || byte != 0 {
                    data.append(byte)
                }
            }
        }
        return data.isEmpty ? Data([0]) : data
    }

    static func < (lhs: BigUInt, rhs: BigUInt) -> Bool {
        if lhs.limbs.count != rhs.limbs.count {
            return lhs.limbs.count < rhs.limbs.count
        }
        for i in (0..<lhs.limbs.count).reversed() where lhs.limbs[i] != rhs.limbs[i] {
            return lhs.limbs[i] < rhs.limbs[i]
        }
        return false
    }

    static func + (lhs: BigUInt, rhs: BigUInt) -> BigUInt {
        var result = BigUInt()
        var carry: UInt64 = 0
        let maxLen = max(lhs.limbs.count, rhs.limbs.count)

        for i in 0..<maxLen {
            let l = i < lhs.limbs.count ? lhs.limbs[i] : 0
            let r = i < rhs.limbs.count ? rhs.limbs[i] : 0
            let (sum1, overflow1) = l.addingReportingOverflow(r)
            let (sum2, overflow2) = sum1.addingReportingOverflow(carry)
            result.limbs.append(sum2)
            carry = (overflow1 ? 1 : 0) + (overflow2 ? 1 : 0)
        }

        if carry > 0 {
            result.limbs.append(carry)
        }

        return result
    }

    static func - (lhs: BigUInt, rhs: BigUInt) -> BigUInt {
        var result = BigUInt()
        var borrow: UInt64 = 0

        for i in 0..<lhs.limbs.count {
            let l = lhs.limbs[i]
            let r = i < rhs.limbs.count ? rhs.limbs[i] : 0
            let (diff1, overflow1) = l.subtractingReportingOverflow(r)
            let (diff2, overflow2) = diff1.subtractingReportingOverflow(borrow)
            result.limbs.append(diff2)
            borrow = (overflow1 ? 1 : 0) + (overflow2 ? 1 : 0)
        }

        // Remove trailing zeros
        while result.limbs.last == 0 {
            result.limbs.removeLast()
        }

        return result
    }

    static func * (lhs: BigUInt, rhs: BigUInt) -> BigUInt {
        guard !lhs.limbs.isEmpty && !rhs.limbs.isEmpty else {
            return BigUInt(0)
        }

        var result = [UInt64](repeating: 0, count: lhs.limbs.count + rhs.limbs.count)

        for i in 0..<lhs.limbs.count {
            var carry: UInt64 = 0
            for j in 0..<rhs.limbs.count {
                let (high, low) = lhs.limbs[i].multipliedFullWidth(by: rhs.limbs[j])
                let (sum1, o1) = result[i + j].addingReportingOverflow(low)
                let (sum2, o2) = sum1.addingReportingOverflow(carry)
                result[i + j] = sum2
                carry = high + (o1 ? 1 : 0) + (o2 ? 1 : 0)
            }
            result[i + rhs.limbs.count] = carry
        }

        var bigResult = BigUInt()
        bigResult.limbs = result
        while bigResult.limbs.last == 0 {
            bigResult.limbs.removeLast()
        }

        return bigResult
    }

    static func / (lhs: BigUInt, rhs: BigUInt) -> BigUInt {
        guard !rhs.limbs.isEmpty else { return BigUInt(0) }
        guard lhs >= rhs else { return BigUInt(0) }

        // Simple long division for now
        var quotient = BigUInt(0)
        var remainder = lhs

        while remainder >= rhs {
            remainder -= rhs
            quotient += BigUInt(1)
        }

        return quotient
    }

    static func % (lhs: BigUInt, rhs: BigUInt) -> BigUInt {
        guard !rhs.limbs.isEmpty else { return BigUInt(0) }
        guard lhs >= rhs else { return lhs }

        var remainder = lhs
        while remainder >= rhs {
            remainder -= rhs
        }

        return remainder
    }

    static func -= (lhs: inout BigUInt, rhs: BigUInt) {
        lhs = lhs - rhs
    }

    static func += (lhs: inout BigUInt, rhs: BigUInt) {
        lhs = lhs + rhs
    }
}

// MARK: - Errors

enum ShamirError: LocalizedError {
    case thresholdTooLow
    case thresholdExceedsTotalShares
    case tooManyShares
    case secretTooLarge
    case noShares
    case insufficientShares(have: Int, need: Int)
    case incompatibleShares
    case corruptedShare(index: Int)
    case invalidShareEncoding

    var errorDescription: String? {
        switch self {
        case .thresholdTooLow:
            return "Threshold must be at least 2"
        case .thresholdExceedsTotalShares:
            return "Threshold cannot exceed total shares"
        case .tooManyShares:
            return "Maximum 255 shares allowed"
        case .secretTooLarge:
            return "Secret must be 32 bytes or less"
        case .noShares:
            return "No shares provided"
        case .insufficientShares(let have, let need):
            return "Need \(need) shares to reconstruct, but only have \(have)"
        case .incompatibleShares:
            return "Shares have incompatible parameters"
        case .corruptedShare(let index):
            return "Share \(index) failed checksum verification"
        case .invalidShareEncoding:
            return "Invalid share encoding"
        }
    }
}

// MARK: - Data Extension

private extension Data {
    init?(hexString: String) {
        let len = hexString.count / 2
        var data = Data(capacity: len)
        var index = hexString.startIndex
        for _ in 0..<len {
            let nextIndex = hexString.index(index, offsetBy: 2)
            guard let byte = UInt8(hexString[index..<nextIndex], radix: 16) else {
                return nil
            }
            data.append(byte)
            index = nextIndex
        }
        self = data
    }
}
