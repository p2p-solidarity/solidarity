//
//  BackupManager.swift
//  solidarity
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

  // 4-byte magic + 1-byte version. v1 = AES-GCM payload via EncryptionManager (master key).
  private static let backupMagic: [UInt8] = [0x53, 0x4F, 0x4C, 0x42] // "SOLB"
  private static let backupVersion: UInt8 = 0x01
  private static let backupHeaderLength = 5

  private var iCloudContainerURL: URL? {
    FileManager.default.url(forUbiquityContainerIdentifier: nil)?.appendingPathComponent("Documents/AirMeishiBackup")
  }

  /// Local backup directory as fallback when iCloud is unavailable.
  private var localBackupURL: URL {
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
      ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Documents")
    return docs.appendingPathComponent("AirMeishiBackup")
  }

  /// Resolved backup directory: iCloud if available, local fallback otherwise.
  private var resolvedBackupURL: URL {
    iCloudContainerURL ?? localBackupURL
  }

  /// Whether iCloud is available for backup.
  var isICloudAvailable: Bool {
    iCloudContainerURL != nil
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

    let containerURL = resolvedBackupURL

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

      // Collect stored credentials from VCLibrary
      let storedCredentials: [BackupStoredCredential] = {
        switch VCLibrary.shared.list() {
        case .success(let creds): return creds.map(BackupStoredCredential.init(from:))
        case .failure: return []
        }
      }()

      let backupData = BackupData(
        version: 3,
        timestamp: Date(),
        businessCards: cards,
        contacts: contacts,
        identityCards: identityCards,
        provableClaims: provableClaims,
        storedCredentials: storedCredentials
      )

      let encryptResult = EncryptionManager.shared.encrypt(backupData)
      let ciphertext: Data
      switch encryptResult {
      case .success(let data): ciphertext = data
      case .failure(let error): return .failure(error)
      }

      var payload = Data()
      payload.append(contentsOf: Self.backupMagic)
      payload.append(Self.backupVersion)
      payload.append(ciphertext)

      let backupURL = containerURL.appendingPathComponent("backup_\(Date().timeIntervalSince1970).solbk")
      try payload.write(to: backupURL, options: [.atomic, .completeFileProtection])

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

  func restoreFromBackup() async -> CardResult<RestoreResult> {
    let containerURL = resolvedBackupURL

    do {
      let files = try FileManager.default.contentsOfDirectory(
        at: containerURL,
        includingPropertiesForKeys: [.creationDateKey]
      )

      // Find latest backup (encrypted .solbk preferred; .json indicates legacy plaintext)
      let candidates = files
        .filter { $0.lastPathComponent.hasPrefix("backup_") && (Self.isBackupFile($0)) }
        .sorted { $0.lastPathComponent > $1.lastPathComponent }

      guard let latestBackup = candidates.first else {
        return .failure(.notFound("No backup found"))
      }

      let raw = try Data(contentsOf: latestBackup)
      let backupData: BackupData
      do {
        backupData = try Self.decodeBackup(raw)
      } catch let error as CardError {
        return .failure(error)
      }

      var result = RestoreResult()

      // Restore business cards
      for card in backupData.businessCards {
        switch cardManager.createCard(card) {
        case .success: result.restoredCards += 1
        case .failure: result.skippedDuplicates += 1
        }
      }

      // Restore contacts
      await MainActor.run {
        for contact in backupData.contacts {
          switch contactRepo.addContact(contact) {
          case .success: result.restoredContacts += 1
          case .failure: result.skippedDuplicates += 1
          }
        }
      }

      // Restore identity cards and provable claims
      await MainActor.run {
        for ic in backupData.identityCards ?? [] {
          IdentityDataStore.shared.addIdentityCard(ic.toEntity())
          result.restoredIdentityCards += 1
        }
        for pc in backupData.provableClaims ?? [] {
          IdentityDataStore.shared.addProvableClaim(pc.toEntity())
          result.restoredClaims += 1
        }
      }

      // Restore stored credentials from VCLibrary
      if let creds = backupData.storedCredentials {
        let existingIds: Set<UUID> = {
          switch VCLibrary.shared.list() {
          case .success(let existing): return Set(existing.map(\.id))
          case .failure: return []
          }
        }()

        for cred in creds {
          if existingIds.contains(cred.id) {
            result.skippedDuplicates += 1
          } else {
            let issued = VCService.IssuedCredential(
              jwt: cred.jwt,
              header: [:],
              payload: [:],
              snapshot: cred.snapshot,
              issuedAt: cred.issuedAt,
              expiresAt: cred.expiresAt,
              holderDid: cred.holderDid,
              issuerDid: cred.issuerDid
            )
            switch VCLibrary.shared.add(issued, status: cred.status) {
            case .success: result.restoredCredentials += 1
            case .failure: result.skippedDuplicates += 1
            }
          }
        }
      }

      return .success(result)
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
        .filter { $0.lastPathComponent.hasPrefix("backup_") && Self.isBackupFile($0) }
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

  // MARK: - Backup Encoding

  private static func isBackupFile(_ url: URL) -> Bool {
    let ext = url.pathExtension.lowercased()
    return ext == "solbk" || ext == "json"
  }

  private static func decodeBackup(_ raw: Data) throws -> BackupData {
    if raw.count >= backupHeaderLength,
       Array(raw.prefix(backupMagic.count)) == backupMagic {
      let version = raw[backupMagic.count]
      guard version == backupVersion else {
        throw CardError.storageError("Unsupported backup version: \(version)")
      }
      let ciphertext = raw.subdata(in: backupHeaderLength..<raw.count)
      let result: CardResult<BackupData> = EncryptionManager.shared.decrypt(ciphertext, as: BackupData.self)
      switch result {
      case .success(let data): return data
      case .failure(let error): throw error
      }
    }

    // Legacy plaintext backup: refuse to silently load PII.
    if raw.first == UInt8(ascii: "{") {
      throw CardError.storageError(
        "Legacy plaintext backup detected and refused. Re-create the backup to upgrade to the encrypted format."
      )
    }

    throw CardError.storageError("Unrecognized backup format")
  }

  // MARK: - Backup Data Types

  struct RestoreResult {
    var restoredCards: Int = 0
    var restoredContacts: Int = 0
    var restoredIdentityCards: Int = 0
    var restoredClaims: Int = 0
    var restoredCredentials: Int = 0
    var skippedDuplicates: Int = 0

    var totalRestored: Int {
      restoredCards + restoredContacts + restoredIdentityCards + restoredClaims + restoredCredentials
    }
  }

  private struct BackupData: Codable, Sendable {
    let version: Int
    let timestamp: Date
    let businessCards: [BusinessCard]
    let contacts: [Contact]
    var identityCards: [BackupIdentityCard]?
    var provableClaims: [BackupProvableClaim]?
    var storedCredentials: [BackupStoredCredential]?
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
    let sourceField: String?
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
      self.sourceField = entity.sourceField
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
        sourceField: sourceField,
        isPresentable: isPresentable,
        lastPresentedAt: lastPresentedAt
      )
    }
  }

  struct BackupStoredCredential: Codable, Sendable {
    let id: UUID
    let jwt: String
    let issuerDid: String
    let holderDid: String
    let issuedAt: Date
    let expiresAt: Date?
    let addedAt: Date
    let lastVerifiedAt: Date?
    let status: VCLibrary.StoredCredential.Status
    let snapshot: BusinessCardSnapshot
    let tags: [String]
    let notes: String?

    init(from credential: VCLibrary.StoredCredential) {
      self.id = credential.id
      self.jwt = credential.jwt
      self.issuerDid = credential.issuerDid
      self.holderDid = credential.holderDid
      self.issuedAt = credential.issuedAt
      self.expiresAt = credential.expiresAt
      self.addedAt = credential.addedAt
      self.lastVerifiedAt = credential.lastVerifiedAt
      self.status = credential.status
      self.snapshot = credential.snapshot
      self.tags = credential.metadata.tags
      self.notes = credential.metadata.notes
    }
  }
}
