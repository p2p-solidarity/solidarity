//
//  AppClipViewModel.swift
//  airmeishiClip
//
//  View model for App Clip handling URL parsing and business card loading
//

import Foundation
import Combine

/// View model for the App Clip content view
class AppClipViewModel: ObservableObject {
    @Published var state: AppClipState = .loading
    @Published var verificationStatus: VerificationStatus = .unverified
    
    var pendingURL: URL?
    
    private var cancellables = Set<AnyCancellable>()
    
    init() {
        // Initialize with loading state
    }
    
    /// Handle incoming URL from QR code or share link
    func handleIncomingURL(_ url: URL) {
        print("App Clip handling URL: \(url)")
        
        state = .loading
        
        // Parse the URL to extract business card data
        parseBusinessCardURL(url)
    }
    
    /// Retry loading the business card
    func retry() {
        if let url = pendingURL {
            handleIncomingURL(url)
        }
    }
    
    // MARK: - Private Methods
    
    /// Parse business card data from URL
    private func parseBusinessCardURL(_ url: URL) {
        // Store URL for retry
        pendingURL = url
        
        // Extract components from URL
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            state = .error(String(localized: "Invalid URL format"))
            return
        }
        
        // Check if this is a share link or direct card data
        if let cardData = extractCardDataFromURL(components) {
            loadBusinessCardFromData(cardData)
        } else if let shareId = extractShareIdFromURL(components) {
            loadBusinessCardFromShareId(shareId)
        } else {
            state = .error(String(localized: "Unable to parse business card information from URL"))
        }
    }
    
    /// Extract embedded card data from URL parameters
    private func extractCardDataFromURL(_ components: URLComponents) -> Data? {
        // Look for embedded card data in URL parameters
        guard let queryItems = components.queryItems else { return nil }
        
        for item in queryItems {
            if item.name == "card" || item.name == "data" {
                if let value = item.value,
                   let data = Data(base64Encoded: value) {
                    return data
                }
            }
        }
        
        return nil
    }
    
    /// Extract share ID from URL for server lookup
    private func extractShareIdFromURL(_ components: URLComponents) -> String? {
        // Look for share ID in path or query parameters
        let pathComponents = components.path.components(separatedBy: "/")
        
        // Check path components for share ID
        for component in pathComponents {
            if component.count > 10 && component.allSatisfy({ $0.isLetter || $0.isNumber }) {
                return component
            }
        }
        
        // Check query parameters
        if let queryItems = components.queryItems {
            for item in queryItems {
                if item.name == "id" || item.name == "share" {
                    return item.value
                }
            }
        }
        
        return nil
    }
    
    /// Load business card from embedded data
    private func loadBusinessCardFromData(_ data: Data) {
        do {
            // Try to decode as business card
            let card = try JSONDecoder().decode(BusinessCard.self, from: data)
            
            // Verify the card data
            verifyBusinessCard(card) { [weak self] verified in
                DispatchQueue.main.async {
                    self?.verificationStatus = verified ? .verified : .unverified
                    self?.state = .loaded(card)
                }
            }
            
        } catch {
            print("Failed to decode business card: \(error)")
            state = .error(String(localized: "Invalid business card data"))
        }
    }
    
    /// Load business card from share ID (would typically involve server call)
    private func loadBusinessCardFromShareId(_ shareId: String) {
        // In a real implementation, this would make a network call to fetch the card
        // For now, we'll simulate this with a mock card
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            // Simulate network delay
            
            // Create a mock business card for demonstration
            let mockCard = self?.createMockBusinessCard(for: shareId)
            
            if let card = mockCard {
                self?.verificationStatus = .unverified
                self?.state = .loaded(card)
            } else {
                self?.state = .notFound
            }
        }
    }
    
    /// Verify business card authenticity (cryptographic verification)
    private func verifyBusinessCard(_ card: BusinessCard, completion: @escaping (Bool) -> Void) {
        // In a real implementation, this would perform cryptographic verification
        // For now, we'll simulate verification
        
        DispatchQueue.global(qos: .background).asyncAfter(deadline: .now() + 0.5) {
            // Simulate verification process
            let isVerified = !card.name.isEmpty && (card.email != nil || card.phone != nil)
            completion(isVerified)
        }
    }
    
    /// Create a mock business card for testing
    private func createMockBusinessCard(for shareId: String) -> BusinessCard? {
        // This is for demonstration purposes only
        // In a real app, this would fetch from a server
        
        guard shareId.count > 5 else { return nil }
        
        return BusinessCard(
            name: "John Doe",
            title: "Software Engineer",
            company: "Tech Corp",
            email: "john.doe@techcorp.com",
            phone: "+1 (555) 123-4567",
            skills: [
                Skill(name: "iOS Development", category: "Programming", proficiencyLevel: .expert),
                Skill(name: "SwiftUI", category: "Framework", proficiencyLevel: .advanced),
                Skill(name: "Privacy Engineering", category: "Security", proficiencyLevel: .intermediate)
            ],
            categories: ["Technology", "Mobile Development"]
        )
    }
}

// MARK: - App Clip State

/// Represents the current state of the App Clip
enum AppClipState {
    case loading
    case loaded(BusinessCard)
    case error(String)
    case notFound
}

// MARK: - Supporting Models

/// Simplified business card model for App Clip
struct BusinessCard: Codable, Identifiable {
    let id: UUID
    let name: String
    let title: String?
    let company: String?
    let email: String?
    let phone: String?
    let profileImage: Data?
    let skills: [Skill]
    let categories: [String]
    
    init(
        id: UUID = UUID(),
        name: String,
        title: String? = nil,
        company: String? = nil,
        email: String? = nil,
        phone: String? = nil,
        profileImage: Data? = nil,
        skills: [Skill] = [],
        categories: [String] = []
    ) {
        self.id = id
        self.name = name
        self.title = title
        self.company = company
        self.email = email
        self.phone = phone
        self.profileImage = profileImage
        self.skills = skills
        self.categories = categories
    }
}

/// Simplified skill model for App Clip
struct Skill: Codable, Identifiable {
    let id: UUID
    let name: String
    let category: String
    let proficiencyLevel: ProficiencyLevel
    
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

    var displayName: String {
        switch self {
        case .beginner:
            return String(localized: "Beginner")
        case .intermediate:
            return String(localized: "Intermediate")
        case .advanced:
            return String(localized: "Advanced")
        case .expert:
            return String(localized: "Expert")
        }
    }
}

/// Verification status for business cards
enum VerificationStatus: String, Codable, CaseIterable {
    case verified = "Verified"
    case unverified = "Unverified"
    case failed = "Failed"
    case pending = "Pending"
    
    var displayName: String {
        switch self {
        case .verified:
            return String(localized: "Verified")
        case .unverified:
            return String(localized: "Unverified")
        case .failed:
            return String(localized: "Failed")
        case .pending:
            return String(localized: "Pending")
        }
    }
    
    var systemImageName: String {
        switch self {
        case .verified: return "checkmark.seal.fill"
        case .unverified: return "questionmark.circle"
        case .failed: return "xmark.seal.fill"
        case .pending: return "clock.circle"
        }
    }
    
    var color: String {
        switch self {
        case .verified: return "green"
        case .unverified: return "gray"
        case .failed: return "red"
        case .pending: return "orange"
        }
    }
}
