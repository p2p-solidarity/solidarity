//
//  BusinessCardCredential.swift
//  solidarity
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
  let nameType: NameType
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
    nameType = card.nameType
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

extension BusinessCardSnapshot {
  enum CodingKeys: String, CodingKey {
    case cardId, name, nameType, title, company, emails, phones
    case skills, socialProfiles, categories, animal
    case updatedAt, profileImageDataURI, summary
    case groupContext, sealedRoute
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    cardId = try container.decode(UUID.self, forKey: .cardId)
    name = try container.decode(String.self, forKey: .name)
    nameType = try container.decodeIfPresent(NameType.self, forKey: .nameType) ?? .displayName
    title = try container.decodeIfPresent(String.self, forKey: .title)
    company = try container.decodeIfPresent(String.self, forKey: .company)
    emails = try container.decode([String].self, forKey: .emails)
    phones = try container.decode([String].self, forKey: .phones)
    skills = try container.decode([Skill].self, forKey: .skills)
    socialProfiles = try container.decode([SocialProfile].self, forKey: .socialProfiles)
    categories = try container.decode([String].self, forKey: .categories)
    animal = try container.decodeIfPresent(Animal.self, forKey: .animal)
    updatedAt = try container.decode(Date.self, forKey: .updatedAt)
    profileImageDataURI = try container.decodeIfPresent(String.self, forKey: .profileImageDataURI)
    summary = try container.decodeIfPresent(String.self, forKey: .summary)
    groupContext = try container.decodeIfPresent(GroupCredentialContext.self, forKey: .groupContext)
    sealedRoute = try container.decodeIfPresent(String.self, forKey: .sealedRoute)
  }
}

/// Builds JWT header and payload claims for a self-issued Business Card credential.
struct BusinessCardCredentialClaims {
  static let logger = Logger(subsystem: AppBranding.currentLoggerSubsystem, category: "BusinessCardCredentialClaims")
  static let contexts = [
    "https://www.w3.org/2018/credentials/v1",
    "https://schema.org",
  ]
  static let types = [
    "VerifiableCredential",
    "BusinessCardCredential",
  ]

  let card: BusinessCard
  let issuerDid: String
  let holderDid: String
  let issuanceDate: Date
  let expirationDate: Date?
  let credentialId: UUID
  let publicKeyJwk: PublicKeyJWK
  let sourceCredentialIds: [String]
  let proofClaims: [String]
  let fieldStatuses: [BusinessCardField: FieldVerificationStatus]

  init(
    card: BusinessCard,
    issuerDid: String,
    holderDid: String,
    issuanceDate: Date = Date(),
    expirationDate: Date? = nil,
    credentialId: UUID = UUID(),
    publicKeyJwk: PublicKeyJWK,
    sourceCredentialIds: [String] = [],
    proofClaims: [String] = [],
    fieldStatuses: [BusinessCardField: FieldVerificationStatus] = [:]
  ) {
    self.card = card
    self.issuerDid = issuerDid
    self.holderDid = holderDid
    self.issuanceDate = issuanceDate
    self.expirationDate = expirationDate
    self.credentialId = credentialId
    self.publicKeyJwk = publicKeyJwk
    self.sourceCredentialIds = sourceCredentialIds
    self.proofClaims = proofClaims
    self.fieldStatuses = fieldStatuses
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
    let subject = CredentialSubject(
      holderDid: holderDid,
      snapshot: snapshot,
      publicKey: publicKeyJwk,
      sourceCredentialIds: sourceCredentialIds,
      proofClaims: proofClaims,
      fieldStatuses: fieldStatuses
    )
    Self.logger.info("Credential subject created - id: \(subject.id), name: \(subject.name)")

    Self.logger.info("Creating VC structure")
    let vc = JWTPayloadVC(
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
  let jti: String
  let iss: String
  let sub: String
  let nbf: Int
  let iat: Int
  let exp: Int?
  let vc: JWTPayloadVC
}

private struct JWTPayloadVC: Encodable {
  let context: [String]
  let type: [String]
  let credentialSubject: CredentialSubject

  enum CodingKeys: String, CodingKey {
    case context = "@context"
    case type
    case credentialSubject
  }
}

private struct CredentialSubjectOrganization: Encodable {
  let schemaType: String = "Organization"
  let name: String

  enum CodingKeys: String, CodingKey {
    case schemaType = "@type"
    case name
  }
}

private struct CredentialSubjectSkill: Encodable {
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

private struct CredentialSubjectSocialAccount: Encodable {
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

private struct CredentialSubjectAnimalPreference: Encodable {
  let id: String
  let name: String
}

// MARK: - VC Schema v2 — 4-block credential subject

/// Block 1: subject_core — always present, minimum identity.
private struct SubjectCore: Encodable {
  let name: String
  let nameType: String
  let nameVerificationStatus: String
  let businessCardId: String
  let publicKeyJwk: PublicKeyJWK
}

/// Block 2: verified_contact_claims — only fields backed by source credentials
/// or explicitly self-attested. Unverified data (skills, jobTitle without source)
/// MUST NOT appear here.
private struct VerifiedContactClaims: Encodable {
  let jobTitle: String?
  let worksFor: CredentialSubjectOrganization?
  let email: [String]?
  let telephone: [String]?
  let image: String?
  let contactPoint: [CredentialSubjectSocialAccount]?
  let fieldStatuses: [String: String]?

  enum CodingKeys: String, CodingKey {
    case jobTitle, worksFor, email, telephone, image, contactPoint
    case fieldStatuses
  }
}

/// Block 3: verified_proofs — non-field claims from VerifiedClaimIndex.
private struct VerifiedProofs: Encodable {
  let claims: [String]?
}

/// Block 4: credential_meta — provenance and traceability.
private struct CredentialMeta: Encodable {
  let schemaVersion: Int
  let sourceCredentialIds: [String]?
  let updatedAt: String?
  let groupContext: GroupCredentialContext?
}

private struct CredentialSubject: Encodable {
  let id: String
  let type: [String]

  // Block 1: subject_core
  let subjectCore: SubjectCore
  // Block 2: verified_contact_claims (only verified/attested fields)
  let verifiedContactClaims: VerifiedContactClaims?
  // Block 3: verified_proofs
  let verifiedProofs: VerifiedProofs?
  // Block 4: credential_meta
  let credentialMeta: CredentialMeta

  // Legacy flat fields kept for backward compatibility with v1 verifiers.
  // New verifiers should read from the structured blocks above.
  let name: String
  let summary: String?
  let jobTitle: String?
  let worksFor: CredentialSubjectOrganization?
  let email: [String]?
  let telephone: [String]?
  let image: String?
  let sameAs: [String]?
  let contactPoint: [CredentialSubjectSocialAccount]?
  let businessCardId: String
  let updatedAt: String?
  let publicKeyJwk: PublicKeyJWK
  let groupContext: GroupCredentialContext?

  enum CodingKeys: String, CodingKey {
    case id
    case type = "@type"
    case subjectCore = "subject_core"
    case verifiedContactClaims = "verified_contact_claims"
    case verifiedProofs = "verified_proofs"
    case credentialMeta = "credential_meta"
    // Legacy flat fields
    case name, summary, jobTitle, worksFor
    case email, telephone, image, sameAs, contactPoint
    case businessCardId, updatedAt, publicKeyJwk, groupContext
  }

  init(
    holderDid: String,
    snapshot: BusinessCardSnapshot,
    publicKey: PublicKeyJWK,
    sourceCredentialIds: [String] = [],
    proofClaims: [String] = [],
    fieldStatuses: [BusinessCardField: FieldVerificationStatus] = [:]
  ) {
    BusinessCardCredentialClaims.logger.debug(
      "Initializing CredentialSubject v2 - holderDid: \(holderDid), cardId: \(snapshot.cardId.uuidString)"
    )

    id = holderDid
    type = ["Person", "BusinessCardSubject"]

    // Determine name verification status
    let nameStatus = fieldStatuses[.name] ?? .selfAttested
    let nameTypeValue = snapshot.nameType

    // Block 1: subject_core
    subjectCore = SubjectCore(
      name: snapshot.name,
      nameType: nameTypeValue.rawValue,
      nameVerificationStatus: nameStatus.rawValue,
      businessCardId: snapshot.cardId.uuidString,
      publicKeyJwk: publicKey
    )

    // Block 2: verified_contact_claims — only include fields that are verified or self-attested.
    // Skills and other non-verifiable fields are excluded from VC.
    let resolvedJobTitle = snapshot.title
    let resolvedWorksFor = snapshot.company.map { CredentialSubjectOrganization(name: $0) }
    let resolvedEmail = snapshot.emails.isEmpty ? nil : snapshot.emails
    let resolvedTelephone = snapshot.phones.isEmpty ? nil : snapshot.phones
    let resolvedImage = snapshot.profileImageDataURI
    let resolvedContactPoint: [CredentialSubjectSocialAccount]? = snapshot.socialProfiles.isEmpty
      ? nil
      : snapshot.socialProfiles.map {
        CredentialSubjectSocialAccount(
          contactType: $0.platform,
          identifier: $0.username,
          url: $0.url
        )
      }

    let statusMap: [String: String]? = fieldStatuses.isEmpty
      ? nil
      : Dictionary(uniqueKeysWithValues: fieldStatuses.map { ($0.key.rawValue, $0.value.rawValue) })

    let hasAnyContactClaim = resolvedJobTitle != nil || resolvedWorksFor != nil
      || resolvedEmail != nil || resolvedTelephone != nil
      || resolvedImage != nil || resolvedContactPoint != nil

    verifiedContactClaims = hasAnyContactClaim
      ? VerifiedContactClaims(
        jobTitle: resolvedJobTitle,
        worksFor: resolvedWorksFor,
        email: resolvedEmail,
        telephone: resolvedTelephone,
        image: resolvedImage,
        contactPoint: resolvedContactPoint,
        fieldStatuses: statusMap
      )
      : nil

    // Block 3: verified_proofs
    verifiedProofs = proofClaims.isEmpty
      ? nil
      : VerifiedProofs(claims: proofClaims)

    // Block 4: credential_meta
    credentialMeta = CredentialMeta(
      schemaVersion: 2,
      sourceCredentialIds: sourceCredentialIds.isEmpty ? nil : sourceCredentialIds,
      updatedAt: ISO8601DateFormatter.fullFormatter.string(from: snapshot.updatedAt),
      groupContext: snapshot.groupContext
    )

    // Legacy flat fields for backward compat
    name = snapshot.name
    summary = snapshot.summary
    jobTitle = resolvedJobTitle
    worksFor = resolvedWorksFor
    email = resolvedEmail
    telephone = resolvedTelephone
    image = resolvedImage
    sameAs = snapshot.socialProfiles.compactMap { $0.url?.nilIfEmpty() }
    contactPoint = resolvedContactPoint
    businessCardId = snapshot.cardId.uuidString
    updatedAt = ISO8601DateFormatter.fullFormatter.string(from: snapshot.updatedAt)
    publicKeyJwk = publicKey
    groupContext = snapshot.groupContext

    BusinessCardCredentialClaims.logger.debug(
      "CredentialSubject v2 initialized - sourceCredentials: \(sourceCredentialIds.count), proofs: \(proofClaims.count)"
    )
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

extension Date {
  fileprivate var unixTimestampSeconds: Int {
    return Int(timeIntervalSince1970.rounded())
  }
}

extension ISO8601DateFormatter {
  fileprivate static let fullFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
}
