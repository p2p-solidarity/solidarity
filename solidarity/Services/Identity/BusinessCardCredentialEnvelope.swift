//
//  BusinessCardCredentialEnvelope.swift
//  solidarity
//
//  Credential envelope parsing for business card VCs.
import Foundation

// MARK: - Credential envelope parsing

struct BusinessCardCredentialEnvelope: Decodable {
  struct Payload: Decodable {
    let iss: String?
    let sub: String?
    let iat: Int?
    let nbf: Int?
    let exp: Int?
    let vc: VerifiableCredential
  }

  struct VerifiableCredential: Decodable {
    let type: [String]
    let credentialSubject: CredentialSubject
  }

  struct CredentialSubject: Decodable {
    struct Organization: Decodable {
      let name: String?
    }

    struct Skill: Decodable {
      let name: String
      let inDefinedTermSet: String?
      let description: String?

      enum CodingKeys: String, CodingKey {
        case name
        case inDefinedTermSet
        case description
      }
    }

    struct SocialAccount: Decodable {
      let contactType: String?
      let identifier: String?
      let url: String?
    }

    struct AnimalPreference: Decodable {
      let id: String?
      let name: String?
    }

    // MARK: - v2 structured blocks (optional, nil for v1 VCs)

    struct SubjectCoreBlock: Decodable {
      let name: String?
      let nameType: String?
      let nameVerificationStatus: String?
      let businessCardId: String?
      let publicKeyJwk: PublicKeyJWK?
    }

    struct VerifiedContactClaimsBlock: Decodable {
      let jobTitle: String?
      let worksFor: Organization?
      let email: [String]?
      let telephone: [String]?
      let image: String?
      let contactPoint: [SocialAccount]?
      let fieldStatuses: [String: String]?
    }

    struct VerifiedProofsBlock: Decodable {
      let claims: [String]?
    }

    struct CredentialMetaBlock: Decodable {
      let schemaVersion: Int?
      let sourceCredentialIds: [String]?
      let updatedAt: String?
      let groupContext: GroupCredentialContext?
    }

    let id: String?
    let type: [String]?

    // v2 structured blocks
    let subjectCore: SubjectCoreBlock?
    let verifiedContactClaims: VerifiedContactClaimsBlock?
    let verifiedProofs: VerifiedProofsBlock?
    let credentialMeta: CredentialMetaBlock?

    // Legacy flat fields (v1 compat)
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
    let businessCardId: String?
    let updatedAt: String?
    let publicKeyJwk: PublicKeyJWK?
    let groupContext: GroupCredentialContext?

    enum CodingKeys: String, CodingKey {
      case id, type
      case subjectCore = "subject_core"
      case verifiedContactClaims = "verified_contact_claims"
      case verifiedProofs = "verified_proofs"
      case credentialMeta = "credential_meta"
      case name, summary, jobTitle, worksFor
      case email, telephone, image, sameAs, contactPoint
      case knowsAbout, hasSkill, preferredAnimal
      case businessCardId, updatedAt, publicKeyJwk, groupContext
    }

    /// Schema version: 2 if v2 blocks present, 1 otherwise.
    var schemaVersion: Int {
      credentialMeta?.schemaVersion ?? (subjectCore != nil ? 2 : 1)
    }

    /// Source credential IDs for traceability (v2 only).
    var sourceCredentialIds: [String] {
      credentialMeta?.sourceCredentialIds ?? []
    }

    /// Resolved name type from v2 block or default.
    var resolvedNameType: NameType {
      guard let raw = subjectCore?.nameType else { return .displayName }
      return NameType(rawValue: raw) ?? .displayName
    }
  }

  let payload: Payload?
  let iss: String?
  let sub: String?
  let iat: Int?
  let nbf: Int?
  let exp: Int?
  let vc: VerifiableCredential?

  var issuedAtDate: Date? {
    if let iat = iat {
      return Date(timeIntervalSince1970: TimeInterval(iat))
    }
    if let payloadIat = payload?.iat {
      return Date(timeIntervalSince1970: TimeInterval(payloadIat))
    }
    return nil
  }

  var expirationDate: Date? {
    if let exp = exp {
      return Date(timeIntervalSince1970: TimeInterval(exp))
    }
    if let payloadExp = payload?.exp {
      return Date(timeIntervalSince1970: TimeInterval(payloadExp))
    }
    return nil
  }

  func toBusinessCard() throws -> BusinessCard {
    let envelopeVC: VerifiableCredential
    if let directVc = vc {
      envelopeVC = directVc
    } else if let nestedVc = payload?.vc {
      envelopeVC = nestedVc
    } else {
      throw CardError.invalidData("Credential missing VC payload")
    }

    let subject = envelopeVC.credentialSubject

    // v2: prefer structured blocks, fall back to legacy flat fields.
    let resolvedBusinessCardId = subject.subjectCore?.businessCardId ?? subject.businessCardId
    let cardId = UUID(uuidString: resolvedBusinessCardId ?? "") ?? UUID()

    // For v2, contact claims come from verified_contact_claims block.
    let vcClaims = subject.verifiedContactClaims
    let title = (vcClaims?.jobTitle ?? subject.jobTitle)?.nilIfEmpty()
    let company = (vcClaims?.worksFor?.name ?? subject.worksFor?.name)?.nilIfEmpty()
    let email = (vcClaims?.email ?? subject.email)?.first?.nilIfEmpty()
    let phone = (vcClaims?.telephone ?? subject.telephone)?.first?.nilIfEmpty()

    let resolvedImage = vcClaims?.image ?? subject.image
    var profileImageData: Data?
    if let image = resolvedImage, let data = Data(dataURI: image) {
      profileImageData = data
    }

    let resolvedContactPoints = vcClaims?.contactPoint ?? subject.contactPoint
    let socialNetworks: [SocialNetwork] =
      resolvedContactPoints?
      .compactMap { account in
        guard let platformName = account.contactType?.nilIfEmpty(),
          let username = account.identifier?.nilIfEmpty()
        else { return nil }
        let platform = SocialPlatform(rawValue: platformName) ?? .other
        return SocialNetwork(
          platform: platform,
          username: username,
          url: account.url?.nilIfEmpty()
        )
      } ?? []

    // v2 VCs exclude skills from the credential. Only v1 legacy VCs carry them.
    let skills: [Skill] =
      subject.hasSkill?
      .compactMap { skill in
        let proficiency = ProficiencyLevel(rawValue: skill.description ?? "") ?? .intermediate
        return Skill(
          name: skill.name,
          category: skill.inDefinedTermSet ?? "General",
          proficiencyLevel: proficiency
        )
      } ?? []

    var animal: AnimalCharacter?
    if let animalId = subject.preferredAnimal?.id, let value = AnimalCharacter(rawValue: animalId) {
      animal = value
    }

    let resolvedGroupContext = subject.credentialMeta?.groupContext ?? subject.groupContext
    let resolvedNameType = subject.resolvedNameType

    var card = BusinessCard(
      id: cardId,
      name: subject.name,
      title: title,
      company: company,
      email: email,
      phone: phone,
      profileImage: profileImageData,
      animal: animal,
      socialNetworks: socialNetworks,
      skills: skills,
      categories: subject.knowsAbout ?? [],
      sharingPreferences: SharingPreferences(),
      groupContext: resolvedGroupContext,
      nameType: resolvedNameType,
      createdAt: issuedAtDate ?? Date(),
      updatedAt: Date()
    )

    if let summary = subject.summary, !summary.isEmpty {
      card.categories.append(summary)
    }

    return card
  }
}
