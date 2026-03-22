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
  private init() {
    loadSettings()
  }

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
  private let maxBackupCount = 5
  private let autoBackupInterval: TimeInterval = 24 * 60 * 60 // 24 hours

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

  // MARK: - Auto Backup

  func triggerAutoBackupIfNeeded() {
    guard settings.enabled, settings.autoBackup else { return }

    // Check if enough time has elapsed since last backup
    if let lastBackup = settings.lastBackupAt {
      guard Date().timeIntervalSince(lastBackup) >= autoBackupInterval else { return }
    }

    Task.detached { [weak self] in
      guard let self else { return }
      _ = await self.performBackupNow()
    }
  }

  // MARK: - Backup

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
      let cards: [BusinessCard] =
        switch cardManager.getAllCards() {
        case .success(let c): c
        case .failure: []
        }

      let contacts: [Contact] = await MainActor.run {
        switch contactRepo.getAllContacts() {
        case .success(let c): return c
        case .failure: return []
        }
      }

      // Collect identity cards and provable claims
      let identityCards: [BackupIdentityCard] = await MainActor.run {
        IdentityDataStore.shared.identityCards.map(BackupIdentityCard.init(from:))
      }
      let provableClaims: [BackupProvableClaim] = await MainActor.run {
        IdentityDataStore.shared.provableClaims.map(BackupProvableClaim.init(from:))
      }

      let backupData = BackupData(
        version: 2,
        timestamp: Date(),
        businessCards: cards,
        contacts: contacts,
        identityCards: identityCards,
        provableClaims: provableClaims
      )

      // Save to iCloud
      let encoder = JSONEncoder()
      encoder.outputFormatting = .prettyPrinted
      let data = try encoder.encode(backupData)
      let backupURL = containerURL.appendingPathComponent("backup_\(Date().timeIntervalSince1970).json")
      try data.write(to: backupURL)

      // Rotate old backups
      rotateBackups(in: containerURL)

      // Update settings
      return update { s in
        s.lastBackupAt = Date()
      }
    } catch {
      return .failure(.storageError("Backup failed: \(error.localizedDescription)"))
    }
  }

  // MARK: - Restore

  func restoreFromBackup() async -> CardResult<[BusinessCard]> {
    guard let containerURL = iCloudContainerURL else {
      return .failure(.configurationError("iCloud not available"))
    }

    do {
      let files = try FileManager.default.contentsOfDirectory(
        at: containerURL,
        includingPropertiesForKeys: [.creationDateKey]
      )

      // Find latest backup
      guard
        let latestBackup =
          files
          .filter({ $0.lastPathComponent.hasPrefix("backup_") && $0.pathExtension == "json" })
          .sorted(by: { $0.lastPathComponent > $1.lastPathComponent })
          .first
      else {
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

      // Restore identity cards and provable claims
      await MainActor.run {
        for ic in backupData.identityCards ?? [] {
          IdentityDataStore.shared.addIdentityCard(ic.toEntity())
        }
        for pc in backupData.provableClaims ?? [] {
          IdentityDataStore.shared.addProvableClaim(pc.toEntity())
        }
      }

      return .success(backupData.businessCards)
    } catch {
      return .failure(.storageError("Restore failed: \(error.localizedDescription)"))
    }
  }

  // MARK: - Backup Rotation

  private func rotateBackups(in containerURL: URL) {
    do {
      let files = try FileManager.default.contentsOfDirectory(
        at: containerURL,
        includingPropertiesForKeys: nil
      )

      let backups = files
        .filter { $0.lastPathComponent.hasPrefix("backup_") && $0.pathExtension == "json" }
        .sorted { $0.lastPathComponent > $1.lastPathComponent } // newest first

      // Remove oldest backups beyond the limit
      if backups.count > maxBackupCount {
        for file in backups.dropFirst(maxBackupCount) {
          try? FileManager.default.removeItem(at: file)
        }
      }
    } catch {
      print("[BackupManager] Rotation failed: \(error.localizedDescription)")
    }
  }

  // MARK: - Backup Data Types

  private struct BackupData: Codable, Sendable {
    let version: Int
    let timestamp: Date
    let businessCards: [BusinessCard]
    let contacts: [Contact]
    var identityCards: [BackupIdentityCard]?
    var provableClaims: [BackupProvableClaim]?
  }

  struct BackupIdentityCard: Codable, Sendable {
    let id: String
    let type: String
    let issuerType: String
    let trustLevel: String
    let title: String
    let issuerDid: String
    let holderDid: String
    let issuedAt: Date
    let expiresAt: Date?
    let status: String
    let sourceReference: String?
    let rawCredentialJWT: String?
    let metadataTags: [String]

    init(from entity: IdentityCardEntity) {
      self.id = entity.id
      self.type = entity.type
      self.issuerType = entity.issuerType
      self.trustLevel = entity.trustLevel
      self.title = entity.title
      self.issuerDid = entity.issuerDid
      self.holderDid = entity.holderDid
      self.issuedAt = entity.issuedAt
      self.expiresAt = entity.expiresAt
      self.status = entity.status
      self.sourceReference = entity.sourceReference
      self.rawCredentialJWT = entity.rawCredentialJWT
      self.metadataTags = entity.metadataTags
    }

    func toEntity() -> IdentityCardEntity {
      IdentityCardEntity(
        id: id,
        type: type,
        issuerType: issuerType,
        trustLevel: trustLevel,
        title: title,
        issuerDid: issuerDid,
        holderDid: holderDid,
        issuedAt: issuedAt,
        expiresAt: expiresAt,
        status: status,
        sourceReference: sourceReference,
        rawCredentialJWT: rawCredentialJWT,
        metadataTags: metadataTags
      )
    }
  }

  struct BackupProvableClaim: Codable, Sendable {
    let id: String
    let identityCardId: String
    let claimType: String
    let title: String
    let issuerType: String
    let trustLevel: String
    let source: String
    let payload: String
    let isPresentable: Bool
    let lastPresentedAt: Date?

    init(from entity: ProvableClaimEntity) {
      self.id = entity.id
      self.identityCardId = entity.identityCardId
      self.claimType = entity.claimType
      self.title = entity.title
      self.issuerType = entity.issuerType
      self.trustLevel = entity.trustLevel
      self.source = entity.source
      self.payload = entity.payload
      self.isPresentable = entity.isPresentable
      self.lastPresentedAt = entity.lastPresentedAt
    }

    func toEntity() -> ProvableClaimEntity {
      ProvableClaimEntity(
        id: id,
        identityCardId: identityCardId,
        claimType: claimType,
        title: title,
        issuerType: issuerType,
        trustLevel: trustLevel,
        source: source,
        payload: payload,
        isPresentable: isPresentable,
        lastPresentedAt: lastPresentedAt
      )
    }
  }
}
