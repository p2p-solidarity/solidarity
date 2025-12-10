//
//  BusinessCardCredential.swift
//  airmeishi
//
//  Schema helpers for issuing Verifiable Credentials derived from BusinessCard data.
//

import Foundation
import os

/// Snapshot of a `BusinessCard` used for credential generation and storage.
struct BusinessCardSnapshot: Codable, Equatable {
    struct Skill: Codable, Equatable {
        let name: String
        let category: String
        let proficiency: String
    }

    struct SocialProfile: Codable, Equatable {
        let platform: String
        let username: String
        let url: String?
    }

    struct Animal: Codable, Equatable {
        let id: String
        let displayName: String
    }

    let cardId: UUID
    let name: String
    let title: String?
    let company: String?
    let emails: [String]
    let phones: [String]
    let skills: [Skill]
    let socialProfiles: [SocialProfile]
    let categories: [String]
    let animal: Animal?
    let updatedAt: Date
    let profileImageDataURI: String?
    let summary: String?
    let groupContext: GroupCredentialContext?
    let sealedRoute: String?

    init(card: BusinessCard, sealedRoute: String? = nil) {
        cardId = card.id
        name = card.name
        title = card.title?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty()
        company = card.company?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty()
        emails = [card.email?.trimmingCharacters(in: .whitespacesAndNewlines)].compactMap { $0?.nilIfEmpty() }
        phones = [card.phone?.trimmingCharacters(in: .whitespacesAndNewlines)].compactMap { $0?.nilIfEmpty() }
        skills = card.skills.map {
            Skill(
                name: $0.name,
                category: $0.category,
                proficiency: $0.proficiencyLevel.rawValue
            )
        }
        socialProfiles = card.socialNetworks.map {
            SocialProfile(
                platform: $0.platform.rawValue,
                username: $0.username,
                url: $0.url
            )
        }
        categories = card.categories
        if let animalCharacter = card.animal {
            animal = Animal(id: animalCharacter.rawValue, displayName: animalCharacter.displayName)
        } else {
            animal = nil
        }
        updatedAt = card.updatedAt
        if let imageData = card.profileImage {
            profileImageDataURI = "data:image/png;base64,\(imageData.base64EncodedString())"
        } else {
            profileImageDataURI = nil
        }
        groupContext = card.groupContext
        self.sealedRoute = sealedRoute

        if let title = title, let company = company {
            summary = "\(title) @ \(company)"
        } else if let title = title {
            summary = title
        } else if let company = company {
            summary = company
        } else {
            summary = nil
        }
    }
}

/// Builds JWT header and payload claims for a self-issued Business Card credential.
struct BusinessCardCredentialClaims {
    static let logger = Logger(subsystem: "com.kidneyweakx.airmeishi", category: "BusinessCardCredentialClaims")
    static let contexts = [
        "https://www.w3.org/2018/credentials/v1",
        "https://schema.org"
    ]
    static let types = [
        "VerifiableCredential",
        "BusinessCardCredential"
    ]

    let card: BusinessCard
    let issuerDid: String
    let holderDid: String
    let issuanceDate: Date
    let expirationDate: Date?
    let credentialId: UUID
    let publicKeyJwk: PublicKeyJWK

    init(
        card: BusinessCard,
        issuerDid: String,
        holderDid: String,
        issuanceDate: Date = Date(),
        expirationDate: Date? = nil,
        credentialId: UUID = UUID(),
        publicKeyJwk: PublicKeyJWK
    ) {
        self.card = card
        self.issuerDid = issuerDid
        self.holderDid = holderDid
        self.issuanceDate = issuanceDate
        self.expirationDate = expirationDate
        self.credentialId = credentialId
        self.publicKeyJwk = publicKeyJwk
    }

    var snapshot: BusinessCardSnapshot {
        BusinessCardSnapshot(card: card)
    }

    func headerData(kid: String) throws -> Data {
        Self.logger.info("Encoding JWT header with kid: \(kid)")
        let header = JWTHeader(kid: kid)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        do {
            let data = try encoder.encode(header)
            Self.logger.info("Header encoded successfully, size: \(data.count) bytes")
            return data
        } catch {
            Self.logger.error("Failed to encode header: \(error.localizedDescription)")
            throw error
        }
    }

    func payloadData() throws -> Data {
        Self.logger.info("Creating credential subject from snapshot")
        let subject = CredentialSubject(holderDid: holderDid, snapshot: snapshot, publicKey: publicKeyJwk)
        Self.logger.info("Credential subject created - id: \(subject.id), name: \(subject.name)")
        
        Self.logger.info("Creating VC structure")
        let vc = JWTPayload.VC(
            context: Self.contexts,
            type: Self.types,
            credentialSubject: subject
        )
        
        Self.logger.info("Creating JWT payload - jti: \(credentialId.uuidString), iss: \(issuerDid), sub: \(holderDid)")
        let payload = JWTPayload(
            jti: "urn:uuid:\(credentialId.uuidString)",
            iss: issuerDid,
            sub: holderDid,
            nbf: issuanceDate.unixTimestampSeconds,
            iat: issuanceDate.unixTimestampSeconds,
            exp: expirationDate?.unixTimestampSeconds,
            vc: vc
        )

        Self.logger.info("Encoding payload to JSON")
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        do {
            let data = try encoder.encode(payload)
            Self.logger.info("Payload encoded successfully, size: \(data.count) bytes")
            
            // Log payload preview for debugging
            if let payloadString = String(data: data, encoding: .utf8) {
                Self.logger.debug("Payload JSON preview: \(payloadString.prefix(200))...")
            }
            
            return data
        } catch {
            Self.logger.error("Failed to encode payload: \(error.localizedDescription)")
            Self.logger.error("Error type: \(String(describing: type(of: error)))")
            if let encodingError = error as? EncodingError {
                Self.logger.error("Encoding error details: \(String(describing: encodingError))")
            }
            throw error
        }
    }

    func payloadDictionary() throws -> [String: Any] {
        let data = try payloadData()
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CardError.invalidData("Failed to serialize credential payload dictionary")
        }
        return json
    }
}

// MARK: - JWT Support Types

private struct JWTHeader: Encodable {
    let alg: String = "ES256"
    let kid: String
    let typ: String = "JWT"
    let cty: String = "application/vc+jwt"
}

private struct JWTPayload: Encodable {
    struct VC: Encodable {
        let context: [String]
        let type: [String]
        let credentialSubject: CredentialSubject

        enum CodingKeys: String, CodingKey {
            case context = "@context"
            case type
            case credentialSubject
        }
    }

    let jti: String
    let iss: String
    let sub: String
    let nbf: Int
    let iat: Int
    let exp: Int?
    let vc: VC
}

private struct CredentialSubject: Encodable {
    struct Organization: Encodable {
        let schemaType: String = "Organization"
        let name: String

        enum CodingKeys: String, CodingKey {
            case schemaType = "@type"
            case name
        }
    }

    struct Skill: Encodable {
        let schemaType: String = "DefinedTerm"
        let name: String
        let inDefinedTermSet: String?
        let description: String?

        enum CodingKeys: String, CodingKey {
            case schemaType = "@type"
            case name
            case inDefinedTermSet
            case description
        }
    }

    struct SocialAccount: Encodable {
        let schemaType: String = "ContactPoint"
        let contactType: String
        let identifier: String
        let url: String?

        enum CodingKeys: String, CodingKey {
            case schemaType = "@type"
            case contactType
            case identifier
            case url
        }
    }

    struct AnimalPreference: Encodable {
        let id: String
        let name: String
    }

    let id: String
    let type: [String]
    let name: String
    let summary: String?
    let jobTitle: String?
    let worksFor: Organization?
    let email: [String]?
    let telephone: [String]?
    let image: String?
    let sameAs: [String]?
    let contactPoint: [SocialAccount]?
    let knowsAbout: [String]?
    let hasSkill: [Skill]?
    let preferredAnimal: AnimalPreference?
    let businessCardId: String
    let updatedAt: String?
    let publicKeyJwk: PublicKeyJWK
    let groupContext: GroupCredentialContext?

    enum CodingKeys: String, CodingKey {
        case id
        case type = "@type"
        case name
        case summary
        case jobTitle
        case worksFor
        case email
        case telephone
        case image
        case sameAs
        case contactPoint
        case knowsAbout
        case hasSkill
        case preferredAnimal
        case businessCardId
        case updatedAt
        case publicKeyJwk
        case groupContext
    }

    init(holderDid: String, snapshot: BusinessCardSnapshot, publicKey: PublicKeyJWK) {
        BusinessCardCredentialClaims.logger.debug("Initializing CredentialSubject - holderDid: \(holderDid), cardId: \(snapshot.cardId.uuidString)")
        
        id = holderDid
        type = ["Person", "BusinessCardSubject"]
        name = snapshot.name
        summary = snapshot.summary
        jobTitle = snapshot.title
        if let company = snapshot.company {
            worksFor = Organization(name: company)
            BusinessCardCredentialClaims.logger.debug("Added worksFor organization: \(company)")
        } else {
            worksFor = nil
        }
        email = snapshot.emails.isEmpty ? nil : snapshot.emails
        telephone = snapshot.phones.isEmpty ? nil : snapshot.phones
        image = snapshot.profileImageDataURI
        sameAs = snapshot.socialProfiles.compactMap { $0.url?.nilIfEmpty() }
        if snapshot.socialProfiles.isEmpty {
            contactPoint = nil
        } else {
            contactPoint = snapshot.socialProfiles.map {
                SocialAccount(
                    contactType: $0.platform,
                    identifier: $0.username,
                    url: $0.url
                )
            }
            BusinessCardCredentialClaims.logger.debug("Added \(snapshot.socialProfiles.count) social profiles")
        }
        knowsAbout = snapshot.categories.isEmpty ? nil : snapshot.categories
        if snapshot.skills.isEmpty {
            hasSkill = nil
        } else {
            hasSkill = snapshot.skills.map {
                Skill(
                    name: $0.name,
                    inDefinedTermSet: $0.category.nilIfEmpty(),
                    description: $0.proficiency
                )
            }
            BusinessCardCredentialClaims.logger.debug("Added \(snapshot.skills.count) skills")
        }
        if let animal = snapshot.animal {
            preferredAnimal = AnimalPreference(id: animal.id, name: animal.displayName)
            BusinessCardCredentialClaims.logger.debug("Added animal preference: \(animal.id)")
        } else {
            preferredAnimal = nil
        }
        businessCardId = snapshot.cardId.uuidString
        updatedAt = ISO8601DateFormatter.fullFormatter.string(from: snapshot.updatedAt)
        publicKeyJwk = publicKey
        groupContext = snapshot.groupContext
        
        BusinessCardCredentialClaims.logger.debug("CredentialSubject initialized successfully")
    }
}

// MARK: - Utilities

extension Optional where Wrapped == String {
    func nilIfEmpty() -> String? {
        switch self?.trimmingCharacters(in: .whitespacesAndNewlines) {
        case .some(let value) where !value.isEmpty:
            return value
        default:
            return nil
        }
    }
}

extension String {
    func nilIfEmpty() -> String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

private extension Date {
    var unixTimestampSeconds: Int {
        return Int(timeIntervalSince1970.rounded())
    }
}

private extension ISO8601DateFormatter {
    static let fullFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

