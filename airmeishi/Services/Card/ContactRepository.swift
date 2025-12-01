//
//  ContactRepository.swift
//  airmeishi
//
//  Repository for managing received business cards (contacts) with CRUD operations
//

import Foundation
import Combine

/// Protocol defining contact management operations
@MainActor
protocol ContactRepositoryProtocol {
    func addContact(_ contact: Contact) -> CardResult<Contact>
    func updateContact(_ contact: Contact) -> CardResult<Contact>
    func deleteContact(id: UUID) -> CardResult<Void>
    func getContact(id: UUID) -> CardResult<Contact>
    func getAllContacts() -> CardResult<[Contact]>
    func searchContacts(query: String) -> CardResult<[Contact]>
    func getContactsBySource(_ source: ContactSource) -> CardResult<[Contact]>
    func getContactsByTag(_ tag: String) -> CardResult<[Contact]>
}

/// Repository for managing received business cards with encrypted storage
@MainActor
class ContactRepository: ContactRepositoryProtocol, ObservableObject {
    static let shared = ContactRepository()
    
    @Published private(set) var contacts: [Contact] = []
    @Published private(set) var isLoading = false
    @Published private(set) var lastError: CardError?
    
    private let storageManager = StorageManager.shared
    private var cancellables = Set<AnyCancellable>()
    
    private init() {
        loadContactsFromStorage()
        IdentityCoordinator.shared.verificationStatusesPublisher
            .receive(on: RunLoop.main)
            .sink { [weak self] statuses in
                self?.applyVerificationStatuses(statuses)
            }
            .store(in: &cancellables)
    }
    
    // MARK: - Public Methods
    
    /// Add a new contact, or update if duplicate business card ID exists
    func addContact(_ contact: Contact) -> CardResult<Contact> {
        // Check for duplicate business card IDs
        if let existingIndex = contacts.firstIndex(where: { $0.businessCard.id == contact.businessCard.id }) {
            // Update existing contact instead of returning error
            let existingContact = contacts[existingIndex]
            
            // Create updated contact with merged data
            let updatedContact = Contact(
                id: existingContact.id, // Preserve existing Contact ID
                businessCard: contact.businessCard, // Update business card info
                receivedAt: existingContact.receivedAt, // Keep original received date
                source: existingContact.source, // Keep original source
                tags: mergeTags(existingContact.tags, newTags: contact.tags), // Merge tags
                notes: contact.notes ?? existingContact.notes, // Prefer new notes, fallback to existing
                verificationStatus: contact.verificationStatus, // Update verification status
                lastInteraction: Date(), // Update last interaction time
                sealedRoute: contact.sealedRoute ?? existingContact.sealedRoute,
                pubKey: contact.pubKey ?? existingContact.pubKey,
                signPubKey: contact.signPubKey ?? existingContact.signPubKey
            )
            
            // Store original for rollback
            let originalContact = contacts[existingIndex]
            
            // Update in local array
            contacts[existingIndex] = updatedContact
            
            // Save to storage
            let saveResult = saveContactsToStorage()
            
            switch saveResult {
            case .success:
                return .success(updatedContact)
            case .failure(let error):
                // Rollback on failure
                contacts[existingIndex] = originalContact
                return .failure(error)
            }
        }
        
        // Add new contact to local array
        contacts.append(contact)
        
        // Save to storage
        let saveResult = saveContactsToStorage()
        
        switch saveResult {
        case .success:
            return .success(contact)
        case .failure(let error):
            // Rollback on failure
            contacts.removeAll { $0.id == contact.id }
            return .failure(error)
        }
    }
    
    /// Update an existing contact
    func updateContact(_ contact: Contact) -> CardResult<Contact> {
        // Find the contact to update
        guard let index = contacts.firstIndex(where: { $0.id == contact.id }) else {
            return .failure(.notFound("Contact not found"))
        }
        
        // Store original for rollback
        let originalContact = contacts[index]
        
        // Update in local array
        contacts[index] = contact
        
        // Save to storage
        let saveResult = saveContactsToStorage()
        
        switch saveResult {
        case .success:
            return .success(contact)
        case .failure(let error):
            // Rollback on failure
            contacts[index] = originalContact
            return .failure(error)
        }
    }
    
    /// Delete a contact
    func deleteContact(id: UUID) -> CardResult<Void> {
        // Find the contact to delete
        guard let index = contacts.firstIndex(where: { $0.id == id }) else {
            return .failure(.notFound("Contact not found"))
        }
        
        // Store for rollback
        let deletedContact = contacts[index]
        
        // Remove from local array
        contacts.remove(at: index)
        
        // Save to storage
        let saveResult = saveContactsToStorage()
        
        switch saveResult {
        case .success:
            return .success(())
        case .failure(let error):
            // Rollback on failure
            contacts.insert(deletedContact, at: index)
            return .failure(error)
        }
    }    

    /// Get a specific contact by ID
    func getContact(id: UUID) -> CardResult<Contact> {
        guard let contact = contacts.first(where: { $0.id == id }) else {
            return .failure(.notFound("Contact not found"))
        }
        return .success(contact)
    }
    
    /// Get all contacts
    func getAllContacts() -> CardResult<[Contact]> {
        return .success(contacts.sorted { $0.receivedAt > $1.receivedAt })
    }
    
    /// Search contacts by query
    func searchContacts(query: String) -> CardResult<[Contact]> {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        
        if trimmedQuery.isEmpty {
            return .success(contacts)
        }
        
        let filteredContacts = contacts.filter { $0.matches(searchText: trimmedQuery) }
        return .success(filteredContacts.sorted { $0.receivedAt > $1.receivedAt })
    }
    
    /// Get contacts by source
    func getContactsBySource(_ source: ContactSource) -> CardResult<[Contact]> {
        let filteredContacts = contacts.filter { $0.source == source }
        return .success(filteredContacts.sorted { $0.receivedAt > $1.receivedAt })
    }
    
    /// Get contacts by tag
    func getContactsByTag(_ tag: String) -> CardResult<[Contact]> {
        let filteredContacts = contacts.filter { $0.tags.contains(tag) }
        return .success(filteredContacts.sorted { $0.receivedAt > $1.receivedAt })
    }
    
    /// Get contacts by verification status
    func getContactsByVerificationStatus(_ status: VerificationStatus) -> CardResult<[Contact]> {
        let filteredContacts = contacts.filter { $0.verificationStatus == status }
        return .success(filteredContacts.sorted { $0.receivedAt > $1.receivedAt })
    }
    
    /// Get all unique tags
    func getAllTags() -> [String] {
        let allTags = contacts.flatMap { $0.tags }
        return Array(Set(allTags)).sorted()
    }
    
    /// Get contacts received in the last N days
    func getRecentContacts(days: Int) -> CardResult<[Contact]> {
        let cutoffDate = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        let recentContacts = contacts.filter { $0.receivedAt >= cutoffDate }
        return .success(recentContacts.sorted { $0.receivedAt > $1.receivedAt })
    }
    
    /// Refresh contacts from storage
    func refreshContacts() {
        loadContactsFromStorage()
    } 
   
    /// Get statistics about stored contacts
    func getStatistics() -> ContactStatistics {
        let totalContacts = contacts.count
        let sourceDistribution = Dictionary(grouping: contacts, by: { $0.source })
            .mapValues { $0.count }
        let verificationDistribution = Dictionary(grouping: contacts, by: { $0.verificationStatus })
            .mapValues { $0.count }
        let totalTags = getAllTags().count
        
        return ContactStatistics(
            totalContacts: totalContacts,
            sourceDistribution: sourceDistribution,
            verificationDistribution: verificationDistribution,
            totalTags: totalTags,
            lastUpdated: Date()
        )
    }
    
    // MARK: - Private Methods
    
    /// Merge tags from existing and new contact, avoiding duplicates
    private func mergeTags(_ existingTags: [String], newTags: [String]) -> [String] {
        var merged = Set(existingTags)
        merged.formUnion(newTags)
        return Array(merged).sorted()
    }
    
    /// Load contacts from encrypted storage
    private func loadContactsFromStorage() {
        isLoading = true
        lastError = nil
        
        let loadResult = storageManager.loadContacts()
        
        switch loadResult {
        case .success(let loadedContacts):
            contacts = loadedContacts.sorted { $0.receivedAt > $1.receivedAt }
        case .failure(let error):
            if case .notFound = error {
                // No contacts stored yet, start with empty array
                contacts = []
            } else {
                lastError = error
                print("Failed to load contacts: \(error.localizedDescription)")
            }
        }
        
        isLoading = false
    }
    
    /// Save contacts to encrypted storage
    private func saveContactsToStorage() -> CardResult<Void> {
        storageManager.saveContacts(contacts)
    }

    private func applyVerificationStatuses(_ statuses: [UUID: VerificationStatus]) {
        var updatedContacts = contacts
        var didChange = false

        for (index, contact) in contacts.enumerated() {
            if let status = statuses[contact.businessCard.id], contact.verificationStatus != status {
                updatedContacts[index].verificationStatus = status
                didChange = true
            }
        }

        if didChange {
            contacts = updatedContacts
        }
    }
}

// MARK: - Statistics

struct ContactStatistics: Codable {
    let totalContacts: Int
    let sourceDistribution: [ContactSource: Int]
    let verificationDistribution: [VerificationStatus: Int]
    let totalTags: Int
    let lastUpdated: Date
}