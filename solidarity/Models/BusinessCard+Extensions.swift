//
//  BusinessCard+Extensions.swift
//  solidarity
//
//  Extensions and conformances for BusinessCard and related types
//

import Foundation

// MARK: - Codable compatibility for SharingPreferences (handle missing keys)

extension SharingPreferences {
  private enum CodingKeys: String, CodingKey {
    case publicFields, professionalFields, personalFields, allowForwarding, expirationDate, useZK, sharingFormat
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    var publicSet =
      try container.decodeIfPresent(Set<BusinessCardField>.self, forKey: .publicFields) ?? [.name, .title, .company]
    publicSet.insert(.name)
    self.publicFields = publicSet

    var professionalSet =
      try container.decodeIfPresent(Set<BusinessCardField>.self, forKey: .professionalFields)
      ?? [.name, .title, .company, .email, .skills]
    professionalSet.insert(.name)
    self.professionalFields = professionalSet

    var personalSet =
      try container.decodeIfPresent(Set<BusinessCardField>.self, forKey: .personalFields)
      ?? BusinessCardField.allCases.asSet()
    personalSet.insert(.name)
    self.personalFields = personalSet

    self.allowForwarding = try container.decodeIfPresent(Bool.self, forKey: .allowForwarding) ?? false
    self.expirationDate = try container.decodeIfPresent(Date.self, forKey: .expirationDate)
    self.useZK = try container.decodeIfPresent(Bool.self, forKey: .useZK) ?? true
    self.sharingFormat = try container.decodeIfPresent(SharingFormat.self, forKey: .sharingFormat) ?? .plaintext
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(publicFields, forKey: .publicFields)
    try container.encode(professionalFields, forKey: .professionalFields)
    try container.encode(personalFields, forKey: .personalFields)
    try container.encode(allowForwarding, forKey: .allowForwarding)
    try container.encodeIfPresent(expirationDate, forKey: .expirationDate)
    try container.encode(useZK, forKey: .useZK)
    try container.encode(sharingFormat, forKey: .sharingFormat)
  }
}

// MARK: - Collection Extensions

extension Array where Element == BusinessCardField {
  func asSet() -> Set<BusinessCardField> {
    return Set(self)
  }
}

extension BusinessCardField: Identifiable {
  var id: String { self.rawValue }
}

extension SharingLevel: Identifiable {
  var id: String { self.rawValue }
}

// MARK: - BusinessCard Convenience Extensions

extension BusinessCard {
  var initials: String {
    let components = name.components(separatedBy: " ")
    let initials = components.compactMap { $0.first }.map { String($0) }
    return initials.prefix(2).joined().uppercased()
  }

  var profileImageURL: URL? {
    return nil
  }

  var vCardData: String {
    var vCard = "BEGIN:VCARD\n"
    vCard += "VERSION:3.0\n"
    vCard += "FN:\(name)\n"

    if let title = title, !title.isEmpty {
      vCard += "TITLE:\(title)\n"
    }

    if let company = company, !company.isEmpty {
      vCard += "ORG:\(company)\n"
    }

    if let email = email, !email.isEmpty {
      vCard += "EMAIL:\(email)\n"
    }

    if let phone = phone, !phone.isEmpty {
      vCard += "TEL:\(phone)\n"
    }

    for social in socialNetworks {
      if let url = social.url, !url.isEmpty {
        vCard += "URL:\(url)\n"
      }
    }

    if !skills.isEmpty {
      let skillsText = skills.map { "\($0.name) (\($0.proficiencyLevel.rawValue))" }.joined(separator: ", ")
      vCard += "NOTE:Skills: \(skillsText)\n"
    }

    vCard += "END:VCARD\n"
    return vCard
  }

  static var sample: BusinessCard {
    return BusinessCard(
      name: "Solidarity User",
      title: "Builder",
      company: "Solidarity",
      email: "hello@solidarity.id",
      phone: "",
      socialNetworks: [],
      skills: [],
      categories: []
    )
  }
}
