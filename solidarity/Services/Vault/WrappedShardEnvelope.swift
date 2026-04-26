//
//  WrappedShardEnvelope.swift
//  solidarity
//
//  Authenticated wrapper around a Shamir share. Sealed with AES-256-GCM using
//  a per-vault wrap key, with vault id / guardian / shard index bound into the
//  AAD so a forged shard cannot be substituted at recovery time.
//

import Foundation
import CryptoKit

struct WrappedShardEnvelope: Codable {
    static let schemaVersion: UInt8 = 1

    let schemaVersion: UInt8
    let vaultId: UUID
    let guardianContactId: UUID
    let shardIndex: Int
    let threshold: Int
    let ciphertext: Data

    enum WrapError: LocalizedError {
        case missingWrapKey
        case sealFailed
        case decodeFailed
        case authenticationFailed(guardian: UUID, shardIndex: Int)
        case bindingMismatch

        var errorDescription: String? {
            switch self {
            case .missingWrapKey:
                return "Vault wrap key is unavailable"
            case .sealFailed:
                return "Failed to seal recovery shard"
            case .decodeFailed:
                return "Recovery shard envelope is malformed"
            case .authenticationFailed(let guardian, let idx):
                return "Recovery shard auth failed for guardian \(guardian) (index \(idx))"
            case .bindingMismatch:
                return "Recovery shard envelope binding mismatch"
            }
        }
    }

    static func seal(
        share: Data,
        vaultId: UUID,
        guardianContactId: UUID,
        shardIndex: Int,
        threshold: Int,
        wrapKey: SymmetricKey
    ) throws -> WrappedShardEnvelope {
        let aad = makeAAD(
            vaultId: vaultId,
            guardianContactId: guardianContactId,
            shardIndex: shardIndex,
            schemaVersion: schemaVersion
        )
        let sealed: AES.GCM.SealedBox
        do {
            sealed = try AES.GCM.seal(share, using: wrapKey, authenticating: aad)
        } catch {
            throw WrapError.sealFailed
        }
        guard let combined = sealed.combined else {
            throw WrapError.sealFailed
        }
        return WrappedShardEnvelope(
            schemaVersion: schemaVersion,
            vaultId: vaultId,
            guardianContactId: guardianContactId,
            shardIndex: shardIndex,
            threshold: threshold,
            ciphertext: combined
        )
    }

    func encode() throws -> Data {
        try JSONEncoder().encode(self)
    }

    static func decode(_ data: Data) throws -> WrappedShardEnvelope {
        do {
            return try JSONDecoder().decode(WrappedShardEnvelope.self, from: data)
        } catch {
            throw WrapError.decodeFailed
        }
    }

    func open(
        wrapKey: SymmetricKey,
        expectedVaultId: UUID,
        expectedGuardianContactId: UUID,
        expectedShardIndex: Int,
        expectedThreshold: Int
    ) throws -> Data {
        guard schemaVersion == Self.schemaVersion else {
            throw WrapError.bindingMismatch
        }
        guard vaultId == expectedVaultId,
              guardianContactId == expectedGuardianContactId,
              shardIndex == expectedShardIndex,
              threshold == expectedThreshold else {
            throw WrapError.bindingMismatch
        }
        let aad = Self.makeAAD(
            vaultId: vaultId,
            guardianContactId: guardianContactId,
            shardIndex: shardIndex,
            schemaVersion: schemaVersion
        )
        do {
            let sealed = try AES.GCM.SealedBox(combined: ciphertext)
            return try AES.GCM.open(sealed, using: wrapKey, authenticating: aad)
        } catch {
            throw WrapError.authenticationFailed(guardian: guardianContactId, shardIndex: shardIndex)
        }
    }

    /// Opens with binding values read directly from the envelope. Intended for
    /// recovery flows where the caller has not yet authenticated metadata; the
    /// auth tag still binds these values, so a forged envelope with attacker-
    /// chosen vault/guardian/index will fail to open.
    func openTrustingBindings(wrapKey: SymmetricKey, expectedThreshold: Int) throws -> Data {
        guard schemaVersion == Self.schemaVersion else {
            throw WrapError.bindingMismatch
        }
        guard threshold == expectedThreshold else {
            throw WrapError.bindingMismatch
        }
        let aad = Self.makeAAD(
            vaultId: vaultId,
            guardianContactId: guardianContactId,
            shardIndex: shardIndex,
            schemaVersion: schemaVersion
        )
        do {
            let sealed = try AES.GCM.SealedBox(combined: ciphertext)
            return try AES.GCM.open(sealed, using: wrapKey, authenticating: aad)
        } catch {
            throw WrapError.authenticationFailed(guardian: guardianContactId, shardIndex: shardIndex)
        }
    }

    private static func makeAAD(
        vaultId: UUID,
        guardianContactId: UUID,
        shardIndex: Int,
        schemaVersion: UInt8
    ) -> Data {
        var data = Data()
        withUnsafeBytes(of: vaultId.uuid) { data.append(contentsOf: $0) }
        withUnsafeBytes(of: guardianContactId.uuid) { data.append(contentsOf: $0) }
        var index = Int64(shardIndex).littleEndian
        withUnsafeBytes(of: &index) { data.append(contentsOf: $0) }
        data.append(schemaVersion)
        return data
    }
}
