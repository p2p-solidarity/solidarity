//
//  BusinessCard.swift
//  airmeishi
//
//  Core data model for business cards with privacy controls and skills management
//

import Foundation

/// Main business card data model with comprehensive contact information and privacy controls
struct BusinessCard: Codable, Identifiable, Equatable {
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
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
    
    /// Update the business card and refresh the updatedAt timestamp
    mutating func update() {
        self.updatedAt = Date()
    }
    
    /// Get filtered business card based on sharing preferences for a specific sharing level
    func filteredCard(for sharingLevel: SharingLevel) -> BusinessCard {
        var filtered = self
        let allowedFields = sharingPreferences.fieldsForLevel(sharingLevel)
        
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
}

/// Social network information
struct SocialNetwork: Codable, Identifiable, Equatable {
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

/// Supported social media platforms
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

/// Individual skill with categorization and proficiency levels
struct Skill: Codable, Identifiable, Equatable {
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

/// Proficiency levels for skills
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

/// Privacy controls for selective information sharing
struct SharingPreferences: Codable, Equatable {
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
        useZK: Bool = false,
        sharingFormat: SharingFormat = .plaintext
    ) {
        // Ensure name is always included in all levels
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
    
    /// Get allowed fields for a specific sharing level
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
}

// MARK: - Codable compatibility for SharingPreferences (handle missing keys)

extension SharingPreferences {
    private enum CodingKeys: String, CodingKey {
        case publicFields, professionalFields, personalFields, allowForwarding, expirationDate, useZK, sharingFormat
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        var publicSet = try container.decodeIfPresent(Set<BusinessCardField>.self, forKey: .publicFields) ?? [.name, .title, .company]
        publicSet.insert(.name) // Ensure name is always included
        self.publicFields = publicSet
        
        var professionalSet = try container.decodeIfPresent(Set<BusinessCardField>.self, forKey: .professionalFields) ?? [.name, .title, .company, .email, .skills]
        professionalSet.insert(.name) // Ensure name is always included
        self.professionalFields = professionalSet
        
        var personalSet = try container.decodeIfPresent(Set<BusinessCardField>.self, forKey: .personalFields) ?? BusinessCardField.allCases.asSet()
        personalSet.insert(.name) // Ensure name is always included
        self.personalFields = personalSet
        
        self.allowForwarding = try container.decodeIfPresent(Bool.self, forKey: .allowForwarding) ?? false
        self.expirationDate = try container.decodeIfPresent(Date.self, forKey: .expirationDate)
        self.useZK = try container.decodeIfPresent(Bool.self, forKey: .useZK) ?? false
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

/// Available business card fields for privacy control
enum BusinessCardField: String, Codable, CaseIterable {
    case name = "name"
    case title = "title"
    case company = "company"
    case email = "email"
    case phone = "phone"
    case profileImage = "profileImage"
    case socialNetworks = "socialNetworks"
    case skills = "skills"
    
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
}

/// Sharing levels for privacy control
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
}

// MARK: - Extensions

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

// MARK: - Additional Extensions for Contact Management

extension BusinessCard {
    /// Get initials for profile display
    var initials: String {
        let components = name.components(separatedBy: " ")
        let initials = components.compactMap { $0.first }.map { String($0) }
        return initials.prefix(2).joined().uppercased()
    }
    
    /// Get profile image URL if stored as URL string
    var profileImageURL: URL? {
        // In a real implementation, this might return a URL to a stored image
        // For now, return nil as we're storing image data directly
        return nil
    }
    
    /// Generate vCard data for sharing
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
        
        // Add social networks
        for social in socialNetworks {
            if let url = social.url, !url.isEmpty {
                vCard += "URL:\(url)\n"
            }
        }
        
        // Add skills as notes
        if !skills.isEmpty {
            let skillsText = skills.map { "\($0.name) (\($0.proficiencyLevel.rawValue))" }.joined(separator: ", ")
            vCard += "NOTE:Skills: \(skillsText)\n"
        }
        
        vCard += "END:VCARD\n"
        return vCard
    }
    
    /// Sample business card for previews
    static var sample: BusinessCard {
        return BusinessCard(
            name: "John Doe",
            title: "Senior iOS Developer",
            company: "Tech Corp",
            email: "john.doe@techcorp.com",
            phone: "+1 (555) 123-4567",
            socialNetworks: [
                SocialNetwork(platform: .linkedin, username: "johndoe", url: "https://linkedin.com/in/johndoe"),
                SocialNetwork(platform: .github, username: "johndoe", url: "https://github.com/johndoe")
            ],
            skills: [
                Skill(name: "Swift", category: "Programming", proficiencyLevel: .expert),
                Skill(name: "SwiftUI", category: "UI Framework", proficiencyLevel: .advanced),
                Skill(name: "Core Data", category: "Database", proficiencyLevel: .intermediate)
            ],
            categories: ["Technology", "Mobile Development"]
        )
    }
}

// MARK: - Mail Composer Support

import MessageUI
import UIKit
import SwiftUI

struct MailComposerView: UIViewControllerRepresentable {
    let recipients: [String]
    let subject: String
    let body: String
    
    func makeUIViewController(context: Context) -> MFMailComposeViewController {
        let composer = MFMailComposeViewController()
        composer.mailComposeDelegate = context.coordinator
        composer.setToRecipients(recipients)
        composer.setSubject(subject)
        composer.setMessageBody(body, isHTML: false)
        return composer
    }
    
    func updateUIViewController(_ uiViewController: MFMailComposeViewController, context: Context) {
        // No updates needed
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }
    
    class Coordinator: NSObject, MFMailComposeViewControllerDelegate {
        func mailComposeController(_ controller: MFMailComposeViewController, didFinishWith result: MFMailComposeResult, error: Error?) {
            controller.dismiss(animated: true)
        }
    }
}

// MARK: - Share Sheet Support

struct BusinessCardShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    
    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        return controller
    }
    
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {
        // No updates needed
    }
}