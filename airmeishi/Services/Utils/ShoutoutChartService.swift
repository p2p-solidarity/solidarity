//
//  ShoutoutChartService.swift
//  airmeishi
//
//  3D chart visualization service for shoutout discovery and user search
//

import Foundation
import SwiftUI
import Combine

/// Service for managing 3D chart visualization of users for shoutout discovery
@MainActor
class ShoutoutChartService: ObservableObject {
    static let shared = ShoutoutChartService()
    
    @Published var users: [ShoutoutUser] = []
    @Published var selectedUser: ShoutoutUser?
    @Published var chartData: [ChartDataPoint] = []
    @Published var filteredData: [ChartDataPoint] = []
    @Published var searchQuery = ""
    @Published var selectedTags: Set<String> = []
    @Published var selectedEventType: EventType?
    @Published var selectedCharacterType: CharacterType?
    
    private let contactRepository = ContactRepository.shared
    private var cancellables = Set<AnyCancellable>()
    
    private init() {
        Task {
            await loadUsers()
            generateChartData()
        }
        // Listen for live updates from contacts so shoutout reflects newly saved peers
        contactRepository.$contacts
            .sink { [weak self] contacts in
                guard let self = self else { return }
                self.users = contacts.map { self.mapContactToUser($0) }
                self.generateChartData()
            }
            .store(in: &cancellables)
    }
    
    // MARK: - Data Management
    
    func loadUsers() async {
        let result = contactRepository.getAllContacts()
        switch result {
        case .success(let contacts):
            users = contacts.map { mapContactToUser($0) }
        case .failure(let error):
            print("Failed to load users: \(error)")
            users = []
        }
    }

    private func mapContactToUser(_ contact: Contact) -> ShoutoutUser {
        return ShoutoutUser(
            id: contact.id,
            name: contact.businessCard.name,
            company: contact.businessCard.company ?? "",
            title: contact.businessCard.title ?? "",
            email: contact.businessCard.email ?? "",
            profileImageURL: contact.businessCard.profileImageURL,
            tags: contact.tags,
            eventScore: calculateEventScore(for: contact),
            typeScore: calculateTypeScore(for: contact),
            characterScore: calculateCharacterScore(for: contact),
            lastInteraction: contact.lastInteraction ?? contact.receivedAt,
            verificationStatus: contact.verificationStatus,
            canReceiveSakura: contact.canReceiveSakura,
            sealedRoute: contact.sealedRoute,
            pubKey: contact.pubKey,
            signPubKey: contact.signPubKey
        )
    }
    
    func generateChartData() {
        chartData = users.map { user in
            ChartDataPoint(
                user: user,
                x: user.eventScore,
                y: user.typeScore,
                z: user.characterScore,
                color: getColorForUser(user)
            )
        }
        applyFilters()
    }
    
    // MARK: - Filtering and Search
    
    func applyFilters() {
        var filtered = chartData
        
        // Apply search filter
        if !searchQuery.isEmpty {
            filtered = filtered.filter { dataPoint in
                dataPoint.user.name.localizedCaseInsensitiveContains(searchQuery) ||
                dataPoint.user.company.localizedCaseInsensitiveContains(searchQuery) ||
                dataPoint.user.title.localizedCaseInsensitiveContains(searchQuery) ||
                dataPoint.user.tags.contains { $0.localizedCaseInsensitiveContains(searchQuery) }
            }
        }
        
        // Apply tag filter
        if !selectedTags.isEmpty {
            filtered = filtered.filter { dataPoint in
                !Set(dataPoint.user.tags).isDisjoint(with: selectedTags)
            }
        }
        
        // Apply event type filter
        if let eventType = selectedEventType {
            filtered = filtered.filter { dataPoint in
                dataPoint.user.eventScore >= eventType.minScore && dataPoint.user.eventScore <= eventType.maxScore
            }
        }
        
        // Apply character type filter
        if let characterType = selectedCharacterType {
            filtered = filtered.filter { dataPoint in
                dataPoint.user.characterScore >= characterType.minScore && dataPoint.user.characterScore <= characterType.maxScore
            }
        }
        
        filteredData = filtered
    }
    
    func searchUsers(query: String) {
        searchQuery = query
        applyFilters()
    }
    
    func toggleTag(_ tag: String) {
        if selectedTags.contains(tag) {
            selectedTags.remove(tag)
        } else {
            selectedTags.insert(tag)
        }
        applyFilters()
    }
    
    func clearFilters() {
        searchQuery = ""
        selectedTags.removeAll()
        selectedEventType = nil
        selectedCharacterType = nil
        applyFilters()
    }
    
    // MARK: - Scoring Algorithms
    
    private func calculateEventScore(for contact: Contact) -> Double {
        var score: Double = 0.0
        
        // Base score from interaction frequency
        if let lastInteraction = contact.lastInteraction {
            let daysSinceInteraction = Calendar.current.dateComponents([.day], from: lastInteraction, to: Date()).day ?? 0
            score += max(0, 1.0 - Double(daysSinceInteraction) / 30.0) * 0.3
        }
        
        // Score from verification status
        switch contact.verificationStatus {
        case .verified: score += 0.4
        case .pending: score += 0.2
        case .unverified: score += 0.1
        case .failed: score += 0.0
        }
        
        // Score from source reliability
        switch contact.source {
        case .qrCode: score += 0.2
        case .proximity: score += 0.3
        case .airdrop: score += 0.25
        case .appClip: score += 0.15
        case .manual: score += 0.1
        }
        
        // Score from tags (more tags = more active)
        score += min(0.1, Double(contact.tags.count) * 0.02)
        
        return min(1.0, score)
    }
    
    private func calculateTypeScore(for contact: Contact) -> Double {
        var score: Double = 0.5 // Base score
        
        // Score based on company size/type
        if let company = contact.businessCard.company {
            let companyLower = company.lowercased()
            if companyLower.contains("tech") || companyLower.contains("software") {
                score += 0.2
            } else if companyLower.contains("startup") || companyLower.contains("incubator") {
                score += 0.3
            } else if companyLower.contains("corporate") || companyLower.contains("enterprise") {
                score += 0.1
            }
        }
        
        // Score based on title
        if let title = contact.businessCard.title {
            let titleLower = title.lowercased()
            if titleLower.contains("founder") || titleLower.contains("ceo") || titleLower.contains("cto") {
                score += 0.2
            } else if titleLower.contains("manager") || titleLower.contains("director") {
                score += 0.15
            } else if titleLower.contains("developer") || titleLower.contains("engineer") {
                score += 0.1
            }
        }
        
        // Score based on skills
        let skillCount = contact.businessCard.skills.count
        score += min(0.2, Double(skillCount) * 0.05)
        
        return min(1.0, score)
    }
    
    private func calculateCharacterScore(for contact: Contact) -> Double {
        var score: Double = 0.5 // Base score
        
        // Score based on profile completeness
        var completenessScore = 0.0
        if contact.businessCard.email != nil { completenessScore += 0.2 }
        if contact.businessCard.phone != nil { completenessScore += 0.2 }
        if contact.businessCard.company != nil { completenessScore += 0.2 }
        if contact.businessCard.title != nil { completenessScore += 0.2 }
        if !contact.businessCard.skills.isEmpty { completenessScore += 0.2 }
        
        score += completenessScore * 0.3
        
        // Score based on notes (shows engagement)
        if let notes = contact.notes, !notes.isEmpty {
            score += 0.2
        }
        
        // Score based on tag diversity
        let uniqueTagCategories = Set(contact.tags.map { $0.lowercased().prefix(3) })
        score += min(0.2, Double(uniqueTagCategories.count) * 0.05)
        
        return min(1.0, score)
    }
    
    private func getColorForUser(_ user: ShoutoutUser) -> Color {
        // Color based on verification status and activity
        switch user.verificationStatus {
        case .verified:
            return .green
        case .pending:
            return .orange
        case .unverified:
            return .blue
        case .failed:
            return .red
        }
    }
    
    // MARK: - Available Tags
    
    func getAllTags() -> [String] {
        return contactRepository.getAllTags()
    }
}

// MARK: - Data Models

struct ShoutoutUser: Identifiable, Codable {
    let id: UUID
    let name: String
    let company: String
    let title: String
    let email: String
    let profileImageURL: URL?
    let tags: [String]
    let eventScore: Double
    let typeScore: Double
    let characterScore: Double
    let lastInteraction: Date
    let verificationStatus: VerificationStatus
    let canReceiveSakura: Bool
    
    // Secure Messaging Fields (for sending messages to this user)
    let sealedRoute: String?
    let pubKey: String?
    let signPubKey: String?
    
    var initials: String {
        let components = name.components(separatedBy: " ")
        return components.compactMap { $0.first }.map { String($0) }.joined().uppercased()
    }
}

struct ChartDataPoint: Identifiable {
    let id = UUID()
    let user: ShoutoutUser
    let x: Double // Event score
    let y: Double // Type score
    let z: Double // Character score
    let color: Color
}

// MARK: - Filter Types

enum EventType: String, CaseIterable, Identifiable {
    case highActivity = "High Activity"
    case mediumActivity = "Medium Activity"
    case lowActivity = "Low Activity"
    
    var id: String { rawValue }
    
    var minScore: Double {
        switch self {
        case .highActivity: return 0.7
        case .mediumActivity: return 0.4
        case .lowActivity: return 0.0
        }
    }
    
    var maxScore: Double {
        switch self {
        case .highActivity: return 1.0
        case .mediumActivity: return 0.69
        case .lowActivity: return 0.39
        }
    }
}

enum CharacterType: String, CaseIterable, Identifiable {
    case professional = "Professional"
    case creative = "Creative"
    case technical = "Technical"
    case social = "Social"
    
    var id: String { rawValue }
    
    var minScore: Double {
        switch self {
        case .professional: return 0.7
        case .creative: return 0.5
        case .technical: return 0.6
        case .social: return 0.4
        }
    }
    
    var maxScore: Double {
        switch self {
        case .professional: return 1.0
        case .creative: return 0.69
        case .technical: return 0.79
        case .social: return 0.59
        }
    }
}
