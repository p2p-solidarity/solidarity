//
//  BackupManager.swift
//  airmeishi
//
//  Handles iCloud backup for business cards and contacts
//

import Foundation

@MainActor
final class BackupManager: ObservableObject {
    static let shared = BackupManager()
    private init() {}
    
    struct Settings: Codable {
        var enabled: Bool
        var lastBackupAt: Date?
        var autoBackup: Bool = true
    }
    
    @Published private(set) var settings: Settings = Settings(enabled: false, lastBackupAt: nil)
    @Published private(set) var isBackingUp = false
    
    private let storage = StorageManager.shared
    private let cardManager = CardManager.shared
    private let contactRepo = ContactRepository.shared
    
    private var iCloudContainerURL: URL? {
        FileManager.default.url(forUbiquityContainerIdentifier: nil)?.appendingPathComponent("Documents/AirMeishiBackup")
    }
    
    func loadSettings() {
        switch storage.loadUserPreferences(Settings.self) {
        case .success(let s): settings = s
        case .failure: settings = Settings(enabled: false, lastBackupAt: nil)
        }
    }
    
    @discardableResult
    func update(_ transform: (inout Settings) -> Void) -> CardResult<Void> {
        var s = settings
        transform(&s)
        let result = storage.saveUserPreferences(s)
        switch result {
        case .success:
            settings = s
            return .success(())
        case .failure(let e):
            return .failure(e)
        }
    }
    
    func performBackupNow() async -> CardResult<Void> {
        guard settings.enabled else {
            return .failure(.configurationError("Backup is disabled"))
        }
        
        guard let containerURL = iCloudContainerURL else {
            return .failure(.configurationError("iCloud not available. Sign in to iCloud in Settings."))
        }
        
        await MainActor.run { isBackingUp = true }
        defer { Task { @MainActor in isBackingUp = false } }
        
        do {
            // Create backup directory
            try FileManager.default.createDirectory(at: containerURL, withIntermediateDirectories: true)
            
            // Get data from managers
            let cards: [BusinessCard] = switch cardManager.getAllCards() {
            case .success(let c): c
            case .failure: []
            }
            
            let contacts: [Contact] = await MainActor.run {
                switch contactRepo.getAllContacts() {
                case .success(let c): return c
                case .failure: return []
                }
            }
            
            let backupData = BackupData(
                version: 1,
                timestamp: Date(),
                businessCards: cards,
                contacts: contacts
            )
            
            // Save to iCloud
            let encoder = JSONEncoder()
            encoder.outputFormatting = .prettyPrinted
            let data = try encoder.encode(backupData)
            let backupURL = containerURL.appendingPathComponent("backup_\(Date().timeIntervalSince1970).json")
            try data.write(to: backupURL)
            
            // Update settings
            return update { s in
                s.lastBackupAt = Date()
            }
        } catch {
            return .failure(.storageError("Backup failed: \(error.localizedDescription)"))
        }
    }
    
    func restoreFromBackup() async -> CardResult<[BusinessCard]> {
        guard let containerURL = iCloudContainerURL else {
            return .failure(.configurationError("iCloud not available"))
        }
        
        do {
            let files = try FileManager.default.contentsOfDirectory(at: containerURL, includingPropertiesForKeys: [.creationDateKey])
            
            // Find latest backup
            guard let latestBackup = files
                .filter({ $0.lastPathComponent.hasPrefix("backup_") && $0.pathExtension == "json" })
                .sorted(by: { $0.lastPathComponent > $1.lastPathComponent })
                .first else {
                return .failure(.notFound("No backup found"))
            }
            
            let data = try Data(contentsOf: latestBackup)
            let backupData = try JSONDecoder().decode(BackupData.self, from: data)
            
            // Restore business cards
            for card in backupData.businessCards {
                _ = cardManager.createCard(card)
            }
            
            // Restore contacts
            await MainActor.run {
                for contact in backupData.contacts {
                    _ = contactRepo.addContact(contact)
                }
            }
            
            return .success(backupData.businessCards)
        } catch {
            return .failure(.storageError("Restore failed: \(error.localizedDescription)"))
        }
    }
    
    private struct BackupData: Codable {
        let version: Int
        let timestamp: Date
        let businessCards: [BusinessCard]
        let contacts: [Contact]
    }
}
