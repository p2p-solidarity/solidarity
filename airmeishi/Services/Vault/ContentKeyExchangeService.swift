//
//  ContentKeyExchangeService.swift
//  airmeishi
//
//  Manages content key exchange for decrypt_content scope
//  Enables paid content / authorization-gated decryption
//

import Foundation
import CryptoKit
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Content Key Exchange Service

@MainActor
final class ContentKeyExchangeService: ObservableObject {
    static let shared = ContentKeyExchangeService()

    // MARK: - Published Properties

    @Published private(set) var contentKeys: [ContentKeyEntry] = []
    @Published private(set) var pendingRequests: [ContentAccessRequest] = []

    // MARK: - Private Properties

    private let encryption = FileEncryptionService.shared
    private let userDefaults = UserDefaults.standard
    private let keysStorageKey = "com.solidarity.vault.contentKeys"

    // MARK: - Initialization

    private init() {
        loadStoredKeys()
    }

    // MARK: - Public API (Content Creator Side)

    /// Create encrypted content with a unique content key
    func createEncryptedContent(
        data: Data,
        name: String,
        price: Decimal? = nil,
        expiresAt: Date? = nil,
        maxAccess: Int? = nil
    ) async throws -> EncryptedContentBundle {
        // Generate unique content key
        let contentKey = SymmetricKey(size: .bits256)
        let contentId = UUID()

        // Encrypt the data with content key
        let nonce = AES.GCM.Nonce()
        let sealedBox = try AES.GCM.seal(data, using: contentKey, nonce: nonce)

        guard let combined = sealedBox.combined else {
            throw ContentKeyError.encryptionFailed
        }

        // Store the content key locally
        let keyEntry = ContentKeyEntry(
            contentId: contentId,
            contentName: name,
            contentKey: contentKey.withUnsafeBytes { Data($0) },
            price: price,
            expiresAt: expiresAt,
            maxAccessCount: maxAccess,
            currentAccessCount: 0,
            createdAt: Date(),
            authorizedUsers: []
        )

        contentKeys.append(keyEntry)
        saveStoredKeys()

        return EncryptedContentBundle(
            contentId: contentId,
            encryptedData: combined,
            nonce: Data(nonce),
            checksum: computeChecksum(combined),
            metadata: ContentMetadata(
                name: name,
                size: data.count,
                price: price,
                expiresAt: expiresAt,
                creatorHint: currentUserHint()
            )
        )
    }

    /// Grant access to a user (by their DID or identifier)
    func grantAccess(contentId: UUID, to userId: String) throws {
        guard let index = contentKeys.firstIndex(where: { $0.contentId == contentId }) else {
            throw ContentKeyError.contentNotFound
        }

        // Check limits
        if let maxCount = contentKeys[index].maxAccessCount,
           contentKeys[index].authorizedUsers.count >= maxCount {
            throw ContentKeyError.accessLimitReached
        }

        if let expires = contentKeys[index].expiresAt, Date() > expires {
            throw ContentKeyError.contentExpired
        }

        if !contentKeys[index].authorizedUsers.contains(userId) {
            contentKeys[index].authorizedUsers.append(userId)
            saveStoredKeys()
        }
    }

    /// Revoke access from a user
    func revokeAccess(contentId: UUID, from userId: String) {
        guard let index = contentKeys.firstIndex(where: { $0.contentId == contentId }) else {
            return
        }

        contentKeys[index].authorizedUsers.removeAll { $0 == userId }
        saveStoredKeys()
    }

    /// Get the content key for authorized user (called during OIDC flow)
    func getContentKey(
        for contentId: UUID,
        requesterId: String
    ) throws -> Data {
        guard let entry = contentKeys.first(where: { $0.contentId == contentId }) else {
            throw ContentKeyError.contentNotFound
        }

        // Check authorization
        guard entry.authorizedUsers.contains(requesterId) else {
            throw ContentKeyError.notAuthorized
        }

        // Check expiration
        if let expires = entry.expiresAt, Date() > expires {
            throw ContentKeyError.contentExpired
        }

        // Increment access count
        if let index = contentKeys.firstIndex(where: { $0.contentId == contentId }) {
            contentKeys[index].currentAccessCount += 1
            saveStoredKeys()
        }

        return entry.contentKey
    }

    // MARK: - Public API (Content Consumer Side)

    /// Request access to content (creates pending request)
    func requestAccess(
        contentId: UUID,
        from creatorId: String,
        justification: String? = nil
    ) -> ContentAccessRequest {
        let request = ContentAccessRequest(
            requestId: UUID(),
            contentId: contentId,
            creatorId: creatorId,
            requesterId: currentUserHint(),
            justification: justification,
            status: .pending,
            createdAt: Date()
        )

        pendingRequests.append(request)
        return request
    }

    /// Decrypt content using provided key
    func decryptContent(bundle: EncryptedContentBundle, key: Data) throws -> Data {
        let symmetricKey = SymmetricKey(data: key)
        let sealedBox = try AES.GCM.SealedBox(combined: bundle.encryptedData)
        return try AES.GCM.open(sealedBox, using: symmetricKey)
    }

    /// Handle incoming content access request (creator side)
    func handleAccessRequest(
        _ request: ContentAccessRequest,
        decision: AccessDecision
    ) {
        guard let index = pendingRequests.firstIndex(where: { $0.requestId == request.requestId }) else {
            return
        }

        switch decision {
        case .approve:
            pendingRequests[index].status = .approved
            try? grantAccess(contentId: request.contentId, to: request.requesterId)
        case .deny:
            pendingRequests[index].status = .denied
        }
    }

    /// Get contents I've created
    var myContent: [ContentKeyEntry] {
        contentKeys
    }

    // MARK: - Private Methods

    private func loadStoredKeys() {
        guard let data = userDefaults.data(forKey: keysStorageKey),
              let keys = try? JSONDecoder().decode([ContentKeyEntry].self, from: data) else {
            return
        }
        contentKeys = keys
    }

    private func saveStoredKeys() {
        if let data = try? JSONEncoder().encode(contentKeys) {
            userDefaults.set(data, forKey: keysStorageKey)
        }
    }

    private func computeChecksum(_ data: Data) -> String {
        let hash = SHA256.hash(data: data)
        return hash.compactMap { String(format: "%02x", $0) }.joined()
    }

    private func currentUserHint() -> String {
        #if canImport(UIKit)
        UIDevice.current.identifierForVendor?.uuidString ?? "unknown"
        #else
        "unknown"
        #endif
    }
}

// MARK: - Data Models

struct ContentKeyEntry: Codable, Identifiable {
    var id: UUID { contentId }
    let contentId: UUID
    let contentName: String
    let contentKey: Data
    let price: Decimal?
    let expiresAt: Date?
    let maxAccessCount: Int?
    var currentAccessCount: Int
    let createdAt: Date
    var authorizedUsers: [String]

    var isExpired: Bool {
        if let expires = expiresAt {
            return Date() > expires
        }
        return false
    }

    var accessCountDisplay: String {
        if let max = maxAccessCount {
            return "\(currentAccessCount)/\(max)"
        }
        return "\(currentAccessCount)"
    }
}

struct EncryptedContentBundle: Codable {
    let contentId: UUID
    let encryptedData: Data
    let nonce: Data
    let checksum: String
    let metadata: ContentMetadata

    /// Export as shareable package (e.g., for Telegram/Line)
    func exportAsPackage() -> Data? {
        try? JSONEncoder().encode(self)
    }

    /// Import from package
    static func importFromPackage(_ data: Data) -> EncryptedContentBundle? {
        try? JSONDecoder().decode(EncryptedContentBundle.self, from: data)
    }
}

struct ContentMetadata: Codable {
    let name: String
    let size: Int
    let price: Decimal?
    let expiresAt: Date?
    let creatorHint: String

    var formattedSize: String {
        ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)
    }

    var priceDisplay: String? {
        guard let price = price else { return nil }
        return "$\(price)"
    }
}

struct ContentAccessRequest: Identifiable, Codable {
    var id: UUID { requestId }
    let requestId: UUID
    let contentId: UUID
    let creatorId: String
    let requesterId: String
    let justification: String?
    var status: AccessStatus
    let createdAt: Date

    enum AccessStatus: String, Codable {
        case pending
        case approved
        case denied
        case expired
    }
}

enum AccessDecision {
    case approve
    case deny
}

// MARK: - Errors

enum ContentKeyError: LocalizedError {
    case encryptionFailed
    case contentNotFound
    case notAuthorized
    case contentExpired
    case accessLimitReached
    case decryptionFailed

    var errorDescription: String? {
        switch self {
        case .encryptionFailed: return "Failed to encrypt content"
        case .contentNotFound: return "Content not found"
        case .notAuthorized: return "Not authorized to access this content"
        case .contentExpired: return "Content access has expired"
        case .accessLimitReached: return "Maximum access limit reached"
        case .decryptionFailed: return "Failed to decrypt content"
        }
    }
}
