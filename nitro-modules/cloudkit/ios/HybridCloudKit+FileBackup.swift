//
//  HybridCloudKit+FileBackup.swift
//  @solidarity/nitro-cloudkit (iOS)
//
//  File-based backup blobs, 1:1 with the legacy SwiftUI app
//  (solidarity/Services/Backup/BackupManager.swift). Backups are written as
//  individual `backup_<ts>.solbk` files into the iCloud Drive ubiquity
//  container's Documents/AirMeishiBackup directory, with a LOCAL Documents
//  fallback when iCloud is unavailable.
//
//  This avoids CloudKit record types entirely, so it never hits the
//  "Cannot create new type … in production schema" error that a custom
//  CKRecord type triggers in the production CloudKit environment.
//
//  Threading: every method runs on Promise.async's background executor.
//  `url(forUbiquityContainerIdentifier:)` can block, which is fine off the
//  main thread.
//
//  Security: `content` is base64 of the already-encrypted SOLB blob — we
//  never see plaintext. No PII is logged. Errors are returned via throw
//  (surfaced as a rejected Promise), never fatalError / force-unwrap.
//

import Foundation
import NitroModules

extension HybridCloudKit {

  /// Backup folder name — matches BackupManager.swift's "AirMeishiBackup".
  fileprivate static let backupFolderName = "AirMeishiBackup"

  /// iCloud Drive ubiquity container Documents/AirMeishiBackup, or nil when
  /// iCloud is unavailable (signed out, or the ubiquity-container entitlement
  /// is missing / not provisioned).
  fileprivate var ubiquityBackupDir: URL? {
    FileManager.default
      .url(forUbiquityContainerIdentifier: nil)?
      .appendingPathComponent("Documents/\(Self.backupFolderName)")
  }

  /// Local Documents fallback — used when iCloud is unavailable so a
  /// first-run / signed-out user can still back up locally (mirrors native).
  fileprivate var localBackupDir: URL {
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
      ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Documents")
    return docs.appendingPathComponent(Self.backupFolderName)
  }

  fileprivate var resolvedBackupDir: URL { ubiquityBackupDir ?? localBackupDir }

  fileprivate var backupIsICloud: Bool { ubiquityBackupDir != nil }

  func writeFileBackup(filename: String, content: String) throws -> Promise<Void> {
    return Promise.async {
      guard let data = Data(base64Encoded: content) else {
        throw self.error("bad_backup_content", "Backup content was not valid base64")
      }
      let dir = self.resolvedBackupDir
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let fileURL = dir.appendingPathComponent(filename)
      // iCloud-resident files must stay readable while the device is locked
      // so the daemon can sync them; the bytes are already encrypted at rest.
      // Local-only files lock down with completeFileProtection (1:1 native).
      let options: Data.WritingOptions = self.backupIsICloud
        ? [.atomic]
        : [.atomic, .completeFileProtection]
      try data.write(to: fileURL, options: options)
      self.emit(self.makeEvent(.recordsaved, recordId: filename, recordType: "FileBackup"))
    }
  }

  func readFileBackup(filename: String) throws -> Promise<String> {
    return Promise.async {
      let fileURL = self.resolvedBackupDir.appendingPathComponent(filename)
      guard FileManager.default.fileExists(atPath: fileURL.path) else {
        throw self.error("backup_not_found", "No backup file named \(filename)")
      }
      let data = try Data(contentsOf: fileURL)
      return data.base64EncodedString()
    }
  }

  func listFileBackups() throws -> Promise<[String]> {
    return Promise.async {
      let dir = self.resolvedBackupDir
      guard FileManager.default.fileExists(atPath: dir.path) else { return [] }
      let files = try FileManager.default.contentsOfDirectory(
        at: dir, includingPropertiesForKeys: nil
      )
      return files.map { $0.lastPathComponent }
    }
  }

  func deleteFileBackup(filename: String) throws -> Promise<Void> {
    return Promise.async {
      let fileURL = self.resolvedBackupDir.appendingPathComponent(filename)
      if FileManager.default.fileExists(atPath: fileURL.path) {
        try FileManager.default.removeItem(at: fileURL)
      }
      self.emit(self.makeEvent(.recorddeleted, recordId: filename))
    }
  }

  func getFileBackupMtime(filename: String) throws -> Promise<Double> {
    return Promise.async {
      let fileURL = self.resolvedBackupDir.appendingPathComponent(filename)
      guard FileManager.default.fileExists(atPath: fileURL.path) else { return 0 }
      let values = try fileURL.resourceValues(forKeys: [.contentModificationDateKey])
      guard let modified = values.contentModificationDate else { return 0 }
      // Epoch milliseconds, matching CloudKitRecord.modifiedTime.
      return modified.timeIntervalSince1970 * 1000.0
    }
  }
}
