import Foundation

extension JSONEncoder {
    static var qrEncoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}

struct QRPlaintextPayload: Codable {
    let snapshot: BusinessCardSnapshot
    let shareId: UUID
    let createdAt: Date
    let expirationDate: Date?

    init(
        snapshot: BusinessCardSnapshot,
        shareId: UUID,
        createdAt: Date = Date(),
        expirationDate: Date?
    ) {
        self.snapshot = snapshot
        self.shareId = shareId
        self.createdAt = createdAt
        self.expirationDate = expirationDate
    }
}

struct QRDidSignedPayload: Codable {
    let jwt: String
    let shareId: UUID
    let createdAt: Date
    let expirationDate: Date?
    let issuerDid: String
    let holderDid: String

    init(
        jwt: String,
        shareId: UUID,
        createdAt: Date = Date(),
        expirationDate: Date?,
        issuerDid: String,
        holderDid: String
    ) {
        self.jwt = jwt
        self.shareId = shareId
        self.createdAt = createdAt
        self.expirationDate = expirationDate
        self.issuerDid = issuerDid
        self.holderDid = holderDid
    }
}

struct QRCodeEnvelope: Codable {
    static let currentVersion = 2

    let version: Int
    let format: SharingFormat
    let sharingLevel: SharingLevel
    let shareId: UUID
    let plaintext: QRPlaintextPayload?
    let encryptedPayload: String?
    let didSigned: QRDidSignedPayload?

    init(
        format: SharingFormat,
        sharingLevel: SharingLevel,
        shareId: UUID,
        plaintext: QRPlaintextPayload? = nil,
        encryptedPayload: String? = nil,
        didSigned: QRDidSignedPayload? = nil,
        version: Int = QRCodeEnvelope.currentVersion
    ) {
        self.version = version
        self.format = format
        self.sharingLevel = sharingLevel
        self.shareId = shareId
        self.plaintext = plaintext
        self.encryptedPayload = encryptedPayload
        self.didSigned = didSigned
    }
}

struct QRSharingPayload: Codable {
    let businessCard: BusinessCard
    let sharingLevel: SharingLevel
    let expirationDate: Date
    let shareId: UUID
    let createdAt: Date
    let maxUses: Int?
    let currentUses: Int?
    let issuerCommitment: String?
    let issuerProof: String?
    let sdProof: SelectiveDisclosureProof?
    let format: SharingFormat?

    init(
        businessCard: BusinessCard,
        sharingLevel: SharingLevel,
        expirationDate: Date,
        shareId: UUID,
        createdAt: Date,
        maxUses: Int? = nil,
        currentUses: Int? = nil,
        issuerCommitment: String? = nil,
        issuerProof: String? = nil,
        sdProof: SelectiveDisclosureProof? = nil,
        format: SharingFormat? = nil
    ) {
        self.businessCard = businessCard
        self.sharingLevel = sharingLevel
        self.expirationDate = expirationDate
        self.shareId = shareId
        self.createdAt = createdAt
        self.maxUses = maxUses
        self.currentUses = currentUses
        self.issuerCommitment = issuerCommitment
        self.issuerProof = issuerProof
        self.sdProof = sdProof
        self.format = format
    }
}
