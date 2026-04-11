//
//  ShamirSecretSharing+BigUInt.swift
//  solidarity
//

import Foundation

// MARK: - BigUInt (Lightweight implementation for secret sharing)

struct BigUInt: Equatable, Comparable {
    var limbs: [UInt64]

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

        while limbs.last == 0 {
            limbs.removeLast()
        }

        self.limbs = limbs
    }

    init?(hexString: String) {
        guard let data = Data(shamirHexString: hexString) else {
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

// MARK: - Data Extension

extension Data {
    init?(shamirHexString hexString: String) {
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
