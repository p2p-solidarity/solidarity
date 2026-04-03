//
//  ShamirSecretSharing.swift
//  solidarity
//
//  Shamir Secret Sharing implementation for The Sovereign Vault
//  Used for digital inheritance and emergency key recovery
//

import Foundation
import CryptoKit

// MARK: - Shamir Secret Sharing

final class ShamirSecretSharing {

    static let prime: BigUInt = BigUInt(hexString: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF") ?? BigUInt(0)

    // MARK: - Public API

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

        let secretInt = BigUInt(secret)

        var coefficients = [secretInt]
        for _ in 1..<threshold {
            let randomBytes = (0..<32).map { _ in UInt8.random(in: 0...255) }
            let coeff = BigUInt(Data(randomBytes)) % prime
            coefficients.append(coeff)
        }

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

    static func combine(shares: [SecretShare]) throws -> Data {
        guard !shares.isEmpty else {
            throw ShamirError.noShares
        }

        let threshold = shares[0].threshold
        guard shares.count >= threshold else {
            throw ShamirError.insufficientShares(have: shares.count, need: threshold)
        }

        guard shares.allSatisfy({ $0.threshold == threshold && $0.totalShares == shares[0].totalShares }) else {
            throw ShamirError.incompatibleShares
        }

        for share in shares {
            let expectedChecksum = computeShareChecksum(index: share.index, value: share.value)
            guard share.checksum == expectedChecksum else {
                throw ShamirError.corruptedShare(index: share.index)
            }
        }

        let usedShares = Array(shares.prefix(threshold))

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

            let lagrange = (yi * numerator % prime) * modInverse(denominator, prime) % prime
            secret = (secret + lagrange) % prime
        }

        return secret.serialize()
    }

    // MARK: - Internal Helpers

    static func evaluatePolynomial(coefficients: [BigUInt], x: BigUInt, prime: BigUInt) -> BigUInt {
        var result = BigUInt(0)
        var power = BigUInt(1)

        for coeff in coefficients {
            result = (result + (coeff * power) % prime) % prime
            power = (power * x) % prime
        }

        return result
    }

    static func modInverse(_ a: BigUInt, _ m: BigUInt) -> BigUInt {
        extendedGCD(a, m).1
    }

    static func extendedGCD(_ a: BigUInt, _ b: BigUInt) -> (BigUInt, BigUInt) {
        if a.isZero {
            return (b, BigUInt(0))
        }
        let (g, x) = extendedGCD(b % a, a)
        return (g, (b / a * x + prime - x) % prime)
    }

    static func computeShareChecksum(index: Int, value: Data) -> String {
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

    var encoded: String {
        let data = try? JSONEncoder().encode(self)
        return data?.base64EncodedString() ?? ""
    }

    static func decode(from string: String) throws -> SecretShare {
        guard let data = Data(base64Encoded: string) else {
            throw ShamirError.invalidShareEncoding
        }
        return try JSONDecoder().decode(SecretShare.self, from: data)
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
