//
//  CardManager.swift
//  airmeishi
//
//  Core manager for business card CRUD operations with encrypted storage
//

import Foundation
import Combine

/// Protocol defining business card management operations
protocol BusinessCardManagerProtocol {
    func createCard(_ card: BusinessCard) -> CardResult<BusinessCard>
    func updateCard(_ card: BusinessCard) -> CardResult<BusinessCard>
    func deleteCard(id: UUID) -> CardResult<Void>
    func getCard(id: UUID) -> CardResult<BusinessCard>
    func getAllCards() -> CardResult<[BusinessCard]>
    func searchCards(query: String) -> CardResult<[BusinessCard]>
}

/// Main manager for business card operations with encrypted local storage
class CardManager: BusinessCardManagerProtocol, ObservableObject {
    static let shared = CardManager()
    
    @Published private(set) var businessCards: [BusinessCard] = []
    @Published private(set) var isLoading = false
    @Published private(set) var lastError: CardError?
    
    private let storageManager = StorageManager.shared
    private var cancellables = Set<AnyCancellable>()
    
    private init() {
        loadCardsFromStorage()
    }
    
    // MARK: - Public Methods
    
    /// Create a new business card
    func createCard(_ card: BusinessCard) -> CardResult<BusinessCard> {
        let cardForStorage = normalizedForStorage(card)
        // Validate the card
        if let validationError = validateCard(cardForStorage) {
            return .failure(validationError)
        }
        
        // Check for duplicate names
        if businessCards.contains(where: { $0.name.lowercased() == cardForStorage.name.lowercased() && $0.id != cardForStorage.id }) {
            return .failure(.validationError("A business card with this name already exists"))
        }
        
        // Add to local array
        businessCards.append(cardForStorage)
        
        // Save to storage
        let saveResult = saveCardsToStorage()
        
        switch saveResult {
        case .success:
            return .success(cardForStorage)
        case .failure(let error):
            // Rollback on failure
            businessCards.removeAll { $0.id == cardForStorage.id }
            return .failure(error)
        }
    }
    
    /// Update an existing business card
    func updateCard(_ card: BusinessCard) -> CardResult<BusinessCard> {
        var cardForStorage = normalizedForStorage(card)

        // Validate the card
        if let validationError = validateCard(cardForStorage) {
            return .failure(validationError)
        }
        
        // Find the card to update
        guard let index = businessCards.firstIndex(where: { $0.id == cardForStorage.id }) else {
            return .failure(.notFound("Business card not found"))
        }
        
        // Store original for rollback
        let originalCard = businessCards[index]
        
        // Update the card with new timestamp
        cardForStorage.update()
        
        // Update in local array
        businessCards[index] = cardForStorage
        
        // Save to storage
        let saveResult = saveCardsToStorage()
        
        switch saveResult {
        case .success:
            return .success(cardForStorage)
        case .failure(let error):
            // Rollback on failure
            businessCards[index] = originalCard
            return .failure(error)
        }
    }
    
    /// Delete a business card
    func deleteCard(id: UUID) -> CardResult<Void> {
        // Find the card to delete
        guard let index = businessCards.firstIndex(where: { $0.id == id }) else {
            return .failure(.notFound("Business card not found"))
        }
        
        // Store for rollback
        let deletedCard = businessCards[index]
        
        // Remove from local array
        businessCards.remove(at: index)
        
        // Save to storage
        let saveResult = saveCardsToStorage()
        
        switch saveResult {
        case .success:
            return .success(())
        case .failure(let error):
            // Rollback on failure
            businessCards.insert(deletedCard, at: index)
            return .failure(error)
        }
    }
    
    /// Get a specific business card by ID
    func getCard(id: UUID) -> CardResult<BusinessCard> {
        guard let card = businessCards.first(where: { $0.id == id }) else {
            return .failure(.notFound("Business card not found"))
        }
        return .success(card)
    }
    
    /// Get all business cards
    func getAllCards() -> CardResult<[BusinessCard]> {
        return .success(businessCards)
    }
    
    /// Search business cards by query
    func searchCards(query: String) -> CardResult<[BusinessCard]> {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        
        if trimmedQuery.isEmpty {
            return .success(businessCards)
        }
        
        let lowercaseQuery = trimmedQuery.lowercased()
        let filteredCards = businessCards.filter { card in
            card.name.lowercased().contains(lowercaseQuery) ||
            card.title?.lowercased().contains(lowercaseQuery) == true ||
            card.company?.lowercased().contains(lowercaseQuery) == true ||
            card.email?.lowercased().contains(lowercaseQuery) == true ||
            card.skills.contains { $0.name.lowercased().contains(lowercaseQuery) } ||
            card.categories.contains { $0.lowercased().contains(lowercaseQuery) }
        }
        
        return .success(filteredCards)
    }
    
    /// Get cards by category
    func getCardsByCategory(_ category: String) -> CardResult<[BusinessCard]> {
        let filteredCards = businessCards.filter { card in
            card.categories.contains(category) ||
            card.skills.contains { $0.category == category }
        }
        return .success(filteredCards)
    }
    
    /// Get cards by skill
    func getCardsBySkill(_ skillName: String) -> CardResult<[BusinessCard]> {
        let filteredCards = businessCards.filter { card in
            card.skills.contains { $0.name.lowercased() == skillName.lowercased() }
        }
        return .success(filteredCards)
    }
    
    /// Refresh cards from storage
    func refreshCards() {
        loadCardsFromStorage()
    }

    /// Reorder cards and persist the new order (encoded via `updatedAt` timestamps)
    func reorderCards(to orderedIds: [UUID]) -> CardResult<Void> {
        // Map current cards for quick lookup
        let idToCard: [UUID: BusinessCard] = Dictionary(uniqueKeysWithValues: businessCards.map { ($0.id, $0) })
        var newOrder: [BusinessCard] = []
        for id in orderedIds {
            if let card = idToCard[id] { newOrder.append(card) }
        }
        // Append any cards not present in orderedIds to preserve data
        let remaining = businessCards.filter { !orderedIds.contains($0.id) }
        newOrder.append(contentsOf: remaining)

        // Encode order into updatedAt to maintain order on load (descending sort)
        let now = Date()
        for (index, var card) in newOrder.enumerated() {
            // More recent date should appear earlier when sorted by updatedAt desc
            card.updatedAt = now.addingTimeInterval(-Double(index))
            if let idx = businessCards.firstIndex(where: { $0.id == card.id }) {
                businessCards[idx] = card
            }
        }

        // Re-sort to reflect the new timestamps
        businessCards.sort { $0.updatedAt > $1.updatedAt }

        return saveCardsToStorage()
    }
    
    /// Get statistics about stored cards
    func getStatistics() -> CardStatistics {
        let totalCards = businessCards.count
        let totalSkills = Set(businessCards.flatMap { $0.skills.map { $0.name } }).count
        let totalCategories = Set(businessCards.flatMap { $0.categories }).count
        let averageSkillsPerCard = totalCards > 0 ? Double(businessCards.reduce(0) { $0 + $1.skills.count }) / Double(totalCards) : 0
        
        return CardStatistics(
            totalCards: totalCards,
            totalSkills: totalSkills,
            totalCategories: totalCategories,
            averageSkillsPerCard: averageSkillsPerCard,
            lastUpdated: Date()
        )
    }
    
    // MARK: - Private Methods
    
    private func normalizedForStorage(_ card: BusinessCard) -> BusinessCard {
        var normalized = card
        // Base card should never be permanently tagged as a group VC
        normalized.groupContext = nil
        return normalized
    }
    
    /// Load business cards from encrypted storage
    private func loadCardsFromStorage() {
        isLoading = true
        lastError = nil
        
        let loadResult = storageManager.loadBusinessCards()
        
        switch loadResult {
        case .success(let cards):
            businessCards = cards.sorted { $0.updatedAt > $1.updatedAt }
        case .failure(let error):
            if case .notFound = error {
                // No cards stored yet, start with empty array
                businessCards = []
            } else {
                lastError = error
                print("Failed to load business cards: \(error.localizedDescription)")
            }
        }
        
        isLoading = false
    }
    
    /// Save business cards to encrypted storage
    private func saveCardsToStorage() -> CardResult<Void> {
        return storageManager.saveBusinessCards(businessCards)
    }
    
    /// Validate business card data
    private func validateCard(_ card: BusinessCard) -> CardError? {
        // Name is required
        if card.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .validationError("Name is required")
        }
        
        // Validate email format if provided
        if let email = card.email, !email.isEmpty {
            if !isValidEmail(email) {
                return .validationError("Invalid email format")
            }
        }
        
        // Validate phone format if provided
        if let phone = card.phone, !phone.isEmpty {
            if !isValidPhone(phone) {
                return .validationError("Invalid phone format")
            }
        }
        
        // Validate skills
        for skill in card.skills {
            if skill.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return .validationError("Skill name cannot be empty")
            }
            if skill.category.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return .validationError("Skill category cannot be empty")
            }
        }
        
        return nil
    }
    
    /// Validate email format
    private func isValidEmail(_ email: String) -> Bool {
        let emailRegex = "^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$"
        let emailPredicate = NSPredicate(format: "SELF MATCHES %@", emailRegex)
        return emailPredicate.evaluate(with: email)
    }
    
    /// Validate phone format (basic validation)
    private func isValidPhone(_ phone: String) -> Bool {
        let phoneRegex = "^[+]?[0-9\\s\\-\\(\\)]{10,}$"
        let phonePredicate = NSPredicate(format: "SELF MATCHES %@", phoneRegex)
        return phonePredicate.evaluate(with: phone)
    }
}

// MARK: - Statistics

struct CardStatistics: Codable {
    let totalCards: Int
    let totalSkills: Int
    let totalCategories: Int
    let averageSkillsPerCard: Double
    let lastUpdated: Date
}