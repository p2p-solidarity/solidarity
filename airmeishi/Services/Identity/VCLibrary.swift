//
//  VCLibrary.swift
//  airmeishi
//
//  Encrypted local persistence for Verifiable Credentials.
//

import Foundation

/// Stores issued and received Verifiable Credentials on disk with encryption.
final class VCLibrary {
    struct StoredCredential: Codable, Identifiable, Equatable {
        enum Status: String, Codable {
            case unverified
            case verified
            case failed
            case revoked
        }

        struct Metadata: Codable, Equatable {
            var tags: [String]
            var notes: String?
        }

        let id: UUID
        let jwt: String
        let issuerDid: String
        let holderDid: String
        let issuedAt: Date
        let expiresAt: Date?
        let addedAt: Date
        var lastVerifiedAt: Date?
        var status: Status
        let snapshot: BusinessCardSnapshot
        var metadata: Metadata

        var isExpired: Bool {
            guard let expires = expiresAt else { return false }
            return expires < Date()
        }
    }

    static let shared = VCLibrary()

    private let queue = DispatchQueue(label: "com.kidneyweakx.airmeishi.vclibrary", qos: .userInitiated)
    private let fileManager: FileManager
    private let encryptionManager: EncryptionManager
    private let storageDirectoryName = "AirmeishiStorage"
    private let storageFileName = "vc_library.encrypted"

    private var cache: [StoredCredential] = []
    private var loaded = false

    init(
        fileManager: FileManager = .default,
        encryptionManager: EncryptionManager = .shared
    ) {
        self.fileManager = fileManager
        self.encryptionManager = encryptionManager
    }

    // MARK: - CRUD

    func list() -> CardResult<[StoredCredential]> {
        return queue.sync {
            switch ensureLoaded() {
            case .success:
                return .success(cache.sorted { $0.addedAt > $1.addedAt })
            case .failure(let error):
                return .failure(error)
            }
        }
    }

    func add(
        _ issued: VCService.IssuedCredential,
        status: StoredCredential.Status = .verified,
        metadata: StoredCredential.Metadata = StoredCredential.Metadata(tags: [], notes: nil)
    ) -> CardResult<StoredCredential> {
        return queue.sync {
            switch ensureLoaded() {
            case .failure(let error):
                return .failure(error)
            case .success:
                let record = StoredCredential(
                    id: UUID(),
                    jwt: issued.jwt,
                    issuerDid: issued.issuerDid,
                    holderDid: issued.holderDid,
                    issuedAt: issued.issuedAt,
                    expiresAt: issued.expiresAt,
                    addedAt: Date(),
                    lastVerifiedAt: status == .verified ? Date() : nil,
                    status: status,
                    snapshot: issued.snapshot,
                    metadata: metadata
                )
                cache.append(record)
                switch persist() {
                case .success:
                    return .success(record)
                case .failure(let error):
                    cache.removeAll { $0.id == record.id }
                    return .failure(error)
                }
            }
        }
    }

    func update(_ record: StoredCredential) -> CardResult<Void> {
        return queue.sync {
            switch ensureLoaded() {
            case .failure(let error):
                return .failure(error)
            case .success:
                guard let index = cache.firstIndex(where: { $0.id == record.id }) else {
                    return .failure(.notFound("Credential not found"))
                }
                cache[index] = record
                return persist()
            }
        }
    }

    func remove(id: UUID) -> CardResult<Void> {
        return queue.sync {
            switch ensureLoaded() {
            case .failure(let error):
                return .failure(error)
            case .success:
                let initialCount = cache.count
                cache.removeAll { $0.id == id }
                guard cache.count != initialCount else {
                    return .failure(.notFound("Credential not found"))
                }
                return persist()
            }
        }
    }

    // MARK: - Internal helpers

    private func ensureLoaded() -> CardResult<Void> {
        if loaded {
            return .success(())
        }

        switch ensureStorageDirectory() {
        case .failure(let error):
            return .failure(error)
        case .success:
            break
        }

        let url = storageURL()

        guard fileManager.fileExists(atPath: url.path) else {
            cache = []
            loaded = true
            return .success(())
        }

        do {
            let encryptedData = try Data(contentsOf: url)
            switch encryptionManager.decrypt(encryptedData, as: [StoredCredential].self) {
            case .success(let records):
                cache = records
                loaded = true
                return .success(())
            case .failure(let error):
                return .failure(error)
            }
        } catch {
            return .failure(.storageError("Failed to read credential library: \(error.localizedDescription)"))
        }
    }

    private func persist() -> CardResult<Void> {
        do {
            let encryptedResult = encryptionManager.encrypt(cache)
            switch encryptedResult {
            case .failure(let error):
                return .failure(error)
            case .success(let encryptedData):
                let url = storageURL()
                try encryptedData.write(to: url, options: [.atomic])
                return .success(())
            }
        } catch {
            return .failure(.storageError("Failed to persist credential library: \(error.localizedDescription)"))
        }
    }

    private func storageURL() -> URL {
        let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
        return documents
            .appendingPathComponent(storageDirectoryName, isDirectory: true)
            .appendingPathComponent(storageFileName, isDirectory: false)
    }

    private func ensureStorageDirectory() -> CardResult<Void> {
        let directoryURL = storageURL().deletingLastPathComponent()
        if fileManager.fileExists(atPath: directoryURL.path) {
            return .success(())
        }

        do {
            try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
            return .success(())
        } catch {
            return .failure(.storageError("Failed to create credential storage directory: \(error.localizedDescription)"))
        }
    }
}
