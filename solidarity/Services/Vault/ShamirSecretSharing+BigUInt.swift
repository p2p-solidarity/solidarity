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

    var bitWidth: Int {
        guard let top = limbs.last else { return 0 }
        return (limbs.count - 1) * 64 + (64 - top.leadingZeroBitCount)
    }

    func bit(at index: Int) -> UInt8 {
        let limbIndex = index / 64
        guard limbIndex < limbs.count else { return 0 }
        return UInt8((limbs[limbIndex] >> (index % 64)) & 1)
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

    static func << (lhs: BigUInt, rhs: Int) -> BigUInt {
        guard rhs > 0, !lhs.limbs.isEmpty else { return lhs }
        let limbShift = rhs / 64
        let bitShift = rhs % 64

        var newLimbs = [UInt64](repeating: 0, count: limbShift)
        if bitShift == 0 {
            newLimbs.append(contentsOf: lhs.limbs)
        } else {
            var carry: UInt64 = 0
            for limb in lhs.limbs {
                newLimbs.append((limb << bitShift) | carry)
                carry = limb >> (64 - bitShift)
            }
            if carry > 0 {
                newLimbs.append(carry)
            }
        }

        var result = BigUInt()
        result.limbs = newLimbs
        while result.limbs.last == 0 {
            result.limbs.removeLast()
        }
        return result
    }

    private func divModBinary(_ divisor: BigUInt) -> (BigUInt, BigUInt) {
        precondition(!divisor.isZero, "Division by zero")
        if self < divisor { return (BigUInt(0), self) }
        if divisor == BigUInt(UInt64(1)) { return (self, BigUInt(0)) }

        var quotientLimbs = [UInt64](repeating: 0, count: limbs.count)
        var remainder = BigUInt(0)
        let totalBits = bitWidth

        for i in (0..<totalBits).reversed() {
            remainder = remainder << 1
            if remainder.limbs.isEmpty { remainder.limbs = [0] }
            remainder.limbs[0] |= UInt64(bit(at: i))
            while remainder.limbs.last == 0 { remainder.limbs.removeLast() }

            if remainder >= divisor {
                remainder -= divisor
                let limbIdx = i / 64
                let bitIdx = i % 64
                quotientLimbs[limbIdx] |= (UInt64(1) << bitIdx)
            }
        }

        var quotient = BigUInt()
        quotient.limbs = quotientLimbs
        while quotient.limbs.last == 0 { quotient.limbs.removeLast() }
        return (quotient, remainder)
    }

    static func / (lhs: BigUInt, rhs: BigUInt) -> BigUInt {
        guard !rhs.limbs.isEmpty else { return BigUInt(0) }
        return lhs.divModBinary(rhs).0
    }

    static func % (lhs: BigUInt, rhs: BigUInt) -> BigUInt {
        guard !rhs.limbs.isEmpty else { return BigUInt(0) }
        return lhs.divModBinary(rhs).1
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
