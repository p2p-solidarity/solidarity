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

    let id: String?
    let type: [String]?
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
    let cardId = UUID(uuidString: subject.businessCardId ?? "") ?? UUID()
    let title = subject.jobTitle?.nilIfEmpty()
    let company = subject.worksFor?.name?.nilIfEmpty()
    let email = subject.email?.first?.nilIfEmpty()
    let phone = subject.telephone?.first?.nilIfEmpty()

    var profileImageData: Data?
    if let image = subject.image, let data = Data(dataURI: image) {
      profileImageData = data
    }

    let socialNetworks: [SocialNetwork] =
      subject.contactPoint?
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
      groupContext: subject.groupContext,
      createdAt: issuedAtDate ?? Date(),
      updatedAt: Date()
    )

    if let summary = subject.summary, !summary.isEmpty {
      card.categories.append(summary)
    }

    return card
  }
}
