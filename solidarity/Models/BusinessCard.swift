//
//  BusinessCard.swift
//  solidarity
//
//  Core data model for business cards with privacy controls and skills management
//

import Foundation

struct BusinessCard: Codable, Identifiable, Equatable, Hashable {
  let id: UUID
  var name: String
  var title: String?
  var company: String?
  var email: String?
  var phone: String?
  var profileImage: Data?
  var animal: AnimalCharacter?
  var socialNetworks: [SocialNetwork]
  var skills: [Skill]
  var categories: [String]
  var sharingPreferences: SharingPreferences
  var groupContext: GroupCredentialContext?
  /// Fields that have been cryptographically verified (e.g., from passport, signed exchange).
  /// nil means no verification tracking (legacy cards); empty set means nothing verified.
  var verifiedFields: Set<BusinessCardField>?
  var createdAt: Date
  var updatedAt: Date

  init(
    id: UUID = UUID(),
    name: String,
    title: String? = nil,
    company: String? = nil,
    email: String? = nil,
    phone: String? = nil,
    profileImage: Data? = nil,
    animal: AnimalCharacter? = nil,
    socialNetworks: [SocialNetwork] = [],
    skills: [Skill] = [],
    categories: [String] = [],
    sharingPreferences: SharingPreferences = SharingPreferences(),
    groupContext: GroupCredentialContext? = nil,
    verifiedFields: Set<BusinessCardField>? = nil,
    createdAt: Date = Date(),
    updatedAt: Date = Date()
  ) {
    self.id = id
    self.name = name
    self.title = title
    self.company = company
    self.email = email
    self.phone = phone
    self.profileImage = profileImage
    self.animal = animal
    self.socialNetworks = socialNetworks
    self.skills = skills
    self.categories = categories
    self.sharingPreferences = sharingPreferences
    self.groupContext = groupContext
    self.verifiedFields = verifiedFields
    self.createdAt = createdAt
    self.updatedAt = updatedAt
  }

  mutating func update() {
    self.updatedAt = Date()
  }

  func filteredCard(for sharingLevel: SharingLevel) -> BusinessCard {
    var filtered = self
    let allowedFields = sharingPreferences.effectiveFields(preferredLevel: sharingLevel)

    if !allowedFields.contains(.name) { filtered.name = "" }
    if !allowedFields.contains(.title) { filtered.title = nil }
    if !allowedFields.contains(.company) { filtered.company = nil }
    if !allowedFields.contains(.email) { filtered.email = nil }
    if !allowedFields.contains(.phone) { filtered.phone = nil }
    if !allowedFields.contains(.profileImage) { filtered.profileImage = nil }
    if !allowedFields.contains(.socialNetworks) { filtered.socialNetworks = [] }
    if !allowedFields.contains(.skills) { filtered.skills = [] }

    return filtered
  }

  func filteredCard(for fields: Set<BusinessCardField>) -> BusinessCard {
    var filtered = self
    if !fields.contains(.name) { filtered.name = "" }
    if !fields.contains(.title) { filtered.title = nil }
    if !fields.contains(.company) { filtered.company = nil }
    if !fields.contains(.email) { filtered.email = nil }
    if !fields.contains(.phone) { filtered.phone = nil }
    if !fields.contains(.profileImage) { filtered.profileImage = nil }
    if !fields.contains(.socialNetworks) { filtered.socialNetworks = [] }
    if !fields.contains(.skills) { filtered.skills = [] }
    return filtered
  }

  /// Returns a copy containing only fields that have been cryptographically verified.
  /// Name is always included as the minimum identity field.
  func filteredCardForVerifiedOnly() -> BusinessCard {
    let verified = verifiedFields ?? []
    // Name is always included as minimum identity
    var fields = verified
    fields.insert(.name)
    return filteredCard(for: fields)
  }
}

struct SocialNetwork: Codable, Identifiable, Equatable, Hashable {
  let id: UUID
  var platform: SocialPlatform
  var username: String
  var url: String?

  init(
    id: UUID = UUID(),
    platform: SocialPlatform,
    username: String,
    url: String? = nil
  ) {
    self.id = id
    self.platform = platform
    self.username = username
    self.url = url
  }
}

enum SocialPlatform: String, Codable, CaseIterable {
  case linkedin = "LinkedIn"
  case twitter = "Twitter"
  case instagram = "Instagram"
  case facebook = "Facebook"
  case github = "GitHub"
  case website = "Website"
  case other = "Other"

  var icon: String {
    switch self {
    case .linkedin: return "link"
    case .twitter: return "at"
    case .instagram: return "camera"
    case .facebook: return "person.2"
    case .github: return "curlybraces.square"
    case .website: return "globe"
    case .other: return "link"
    }
  }
}

struct Skill: Codable, Identifiable, Equatable, Hashable {
  let id: UUID
  var name: String
  var category: String
  var proficiencyLevel: ProficiencyLevel

  init(
    id: UUID = UUID(),
    name: String,
    category: String,
    proficiencyLevel: ProficiencyLevel = .intermediate
  ) {
    self.id = id
    self.name = name
    self.category = category
    self.proficiencyLevel = proficiencyLevel
  }
}

enum ProficiencyLevel: String, Codable, CaseIterable {
  case beginner = "Beginner"
  case intermediate = "Intermediate"
  case advanced = "Advanced"
  case expert = "Expert"

  var displayOrder: Int {
    switch self {
    case .beginner: return 1
    case .intermediate: return 2
    case .advanced: return 3
    case .expert: return 4
    }
  }
}

struct SharingPreferences: Codable, Equatable, Hashable {
  var publicFields: Set<BusinessCardField>
  var professionalFields: Set<BusinessCardField>
  var personalFields: Set<BusinessCardField>
  var allowForwarding: Bool
  var expirationDate: Date?
  var useZK: Bool
  var sharingFormat: SharingFormat

  init(
    publicFields: Set<BusinessCardField> = [.name, .title, .company],
    professionalFields: Set<BusinessCardField> = [.name, .title, .company, .email, .skills],
    personalFields: Set<BusinessCardField> = BusinessCardField.allCases.asSet(),
    allowForwarding: Bool = false,
    expirationDate: Date? = nil,
    useZK: Bool = true,
    sharingFormat: SharingFormat = .plaintext
  ) {
    var publicSet = publicFields
    publicSet.insert(.name)
    self.publicFields = publicSet

    var professionalSet = professionalFields
    professionalSet.insert(.name)
    self.professionalFields = professionalSet

    var personalSet = personalFields
    personalSet.insert(.name)
    self.personalFields = personalSet

    self.allowForwarding = allowForwarding
    self.expirationDate = expirationDate
    self.useZK = useZK
    self.sharingFormat = sharingFormat
  }

  func fieldsForLevel(_ level: SharingLevel) -> Set<BusinessCardField> {
    switch level {
    case .`public`:
      return publicFields
    case .professional:
      return professionalFields
    case .personal:
      return personalFields
    }
  }

  func effectiveFields(preferredLevel: SharingLevel) -> Set<BusinessCardField> {
    if publicFields == professionalFields && professionalFields == personalFields {
      return publicFields
    }
    return fieldsForLevel(preferredLevel)
  }
}

enum BusinessCardField: String, Codable, CaseIterable {
  case name
  case title
  case company
  case email
  case phone
  case profileImage
  case socialNetworks
  case skills

  var displayName: String {
    switch self {
    case .name: return "Name"
    case .title: return "Title"
    case .company: return "Company"
    case .email: return "Email"
    case .phone: return "Phone"
    case .profileImage: return "Profile Image"
    case .socialNetworks: return "Social Networks"
    case .skills: return "Skills"
    }
  }

  var icon: String {
    switch self {
    case .name: return "person.text.rectangle"
    case .title: return "id.card"
    case .company: return "building.2"
    case .email: return "envelope"
    case .phone: return "phone"
    case .profileImage: return "person.crop.circle"
    case .socialNetworks: return "link"
    case .skills: return "star"
    }
  }
}

enum SharingLevel: String, Codable, CaseIterable {
  case `public` = "public"
  case professional = "professional"
  case personal = "personal"

  var displayName: String {
    switch self {
    case .`public`: return "Public"
    case .professional: return "Professional"
    case .personal: return "Personal"
    }
  }

  var icon: String {
    switch self {
    case .`public`: return "globe"
    case .professional: return "briefcase"
    case .personal: return "person.2"
    }
  }

  var description: String {
    switch self {
    case .`public`: return "Fields visible when you share your public card (e.g. QR in slides or website)."
    case .professional: return "For work contacts and events. Usually includes email and skills."
    case .personal: return "For close contacts. Typically includes all fields."
    }
  }
}
