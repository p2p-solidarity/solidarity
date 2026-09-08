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

  private func checkedBackupFile(_ filename: String) throws -> (url: URL, isICloud: Bool) {
    guard !filename.isEmpty, filename != ".", filename != "..",
          filename.range(of: "^[A-Za-z0-9_.-]+$", options: .regularExpression) != nil else {
      throw self.error("invalid_filename", "Invalid backup filename")
    }
    if filename.hasPrefix("sync_") {
      guard let directory = ubiquityBackupDir else {
        throw self.error("icloud_unavailable", "iCloud Drive is unavailable")
      }
      return (directory.appendingPathComponent(filename), true)
    }
    if let directory = ubiquityBackupDir {
      return (directory.appendingPathComponent(filename), true)
    }
    return (localBackupDir.appendingPathComponent(filename), false)
  }

  func writeFileBackup(filename: String, content: String) throws -> Promise<Void> {
    return Promise.async {
      guard let data = Data(base64Encoded: content) else {
        throw self.error("bad_backup_content", "Backup content was not valid base64")
      }
      let backupFile = try self.checkedBackupFile(filename)
      let fileURL = backupFile.url
      let dir = fileURL.deletingLastPathComponent()
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      // iCloud-resident files must stay readable while the device is locked
      // so the daemon can sync them; the bytes are already encrypted at rest.
      // Local-only files lock down with completeFileProtection (1:1 native).
      let options: Data.WritingOptions = backupFile.isICloud
        ? [.atomic]
        : [.atomic, .completeFileProtection]
      var coordinationError: NSError?
      var writeError: Error?
      NSFileCoordinator().coordinate(writingItemAt: fileURL, options: .forReplacing, error: &coordinationError) { url in
        do { try data.write(to: url, options: options) } catch { writeError = error }
      }
      if let error = coordinationError ?? writeError as NSError? { throw error }
      self.emit(self.makeEvent(.recordsaved, recordId: filename, recordType: "FileBackup"))
    }
  }

  func readFileBackup(filename: String) throws -> Promise<String> {
    return Promise.async {
      let backupFile = try self.checkedBackupFile(filename)
      let fileURL = backupFile.url
      if backupFile.isICloud {
        try FileManager.default.startDownloadingUbiquitousItem(at: fileURL)
        // Let the next foreground sync retry instead of blocking an executor
        // indefinitely on an offline iCloud download.
        let status = try fileURL.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
        if let downloading = status.ubiquitousItemDownloadingStatus, downloading != .current {
          throw self.error("icloud_download_pending", "iCloud file is still downloading")
        }
      }
      var coordinationError: NSError?
      var result: Result<Data, Error> = .failure(self.error("backup_unreadable", "Backup is unreadable"))
      NSFileCoordinator().coordinate(readingItemAt: fileURL, options: [], error: &coordinationError) { url in
        result = Result { try Data(contentsOf: url) }
      }
      if let error = coordinationError { throw error }
      let data = try result.get()
      return data.base64EncodedString()
    }
  }

  func listFileBackups() throws -> Promise<[String]> {
    return Promise.async {
      let cloudDir = self.ubiquityBackupDir
      let dir = cloudDir ?? self.localBackupDir
      let enumeratedNames: [String]
      if FileManager.default.fileExists(atPath: dir.path) {
        enumeratedNames = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
          .map { $0.lastPathComponent }
          .map { name in
            name.hasPrefix(".") && name.hasSuffix(".icloud")
              ? String(name.dropFirst().dropLast(7)) : name
          }
      } else { enumeratedNames = [] }
      guard cloudDir != nil else { return enumeratedNames }
      // The metadata query only ADDS cloud-only documents. If it stalls or
      // fails, the directory listing we already have is still the truth —
      // throwing it away would fail a restore whose archives are right there.
      let cloudNames = (try? await BackupMetadataListing.names(in: dir)) ?? []
      return Array(Set(cloudNames + enumeratedNames))
    }
  }

  /// An evicted iCloud item is on disk only as its `.<name>.icloud`
  /// placeholder, so `fileExists` on the logical path answers false for a file
  /// that very much exists. Listing already un-mangles those names; delete and
  /// mtime have to resolve them too, or they silently no-op on real files.
  private func placeholderURL(for fileURL: URL) -> URL {
    fileURL.deletingLastPathComponent()
      .appendingPathComponent(".\(fileURL.lastPathComponent).icloud")
  }

  private func existingBackupURL(_ file: (url: URL, isICloud: Bool)) -> URL? {
    if FileManager.default.fileExists(atPath: file.url.path) { return file.url }
    guard file.isICloud else { return nil }
    let placeholder = self.placeholderURL(for: file.url)
    return FileManager.default.fileExists(atPath: placeholder.path) ? file.url : nil
  }

  func deleteFileBackup(filename: String) throws -> Promise<Void> {
    return Promise.async {
      let file = try self.checkedBackupFile(filename)
      if let target = self.existingBackupURL(file) {
        var coordinationError: NSError?
        var removeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forDeleting, error: &coordinationError) { url in
          do { try FileManager.default.removeItem(at: url) } catch { removeError = error }
        }
        if let error = coordinationError ?? removeError as NSError? { throw error }
      }
      self.emit(self.makeEvent(.recorddeleted, recordId: filename))
    }
  }

  func getFileBackupMtime(filename: String) throws -> Promise<Double> {
    return Promise.async {
      let file = try self.checkedBackupFile(filename)
      var target = file.url
      if !FileManager.default.fileExists(atPath: target.path) {
        guard file.isICloud else { return 0 }
        target = self.placeholderURL(for: file.url)
        guard FileManager.default.fileExists(atPath: target.path) else { return 0 }
      }
      let values = try target.resourceValues(forKeys: [.contentModificationDateKey])
      guard let modified = values.contentModificationDate else { return 0 }
      // Epoch milliseconds, matching CloudKitRecord.modifiedTime.
      return modified.timeIntervalSince1970 * 1000.0
    }
  }
}


/// NSMetadataQuery discovers cloud-only documents that directory enumeration
/// alone misses. The query lives on the main run loop, with bounded lifetime.
private final class BackupMetadataListing {
  private let query = NSMetadataQuery()
  private var observer: NSObjectProtocol?
  private var completion: ((Result<[String], Error>) -> Void)?

  static func names(in directory: URL) async throws -> [String] {
    try await withCheckedThrowingContinuation { continuation in
      DispatchQueue.main.async {
        let listing = BackupMetadataListing()
        listing.start(directory: directory) { continuation.resume(with: $0) }
      }
    }
  }

  private func start(directory: URL, completion: @escaping (Result<[String], Error>) -> Void) {
    self.completion = completion
    query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
    query.predicate = NSPredicate(format: "%K BEGINSWITH %@", NSMetadataItemPathKey, directory.path + "/")
    observer = NotificationCenter.default.addObserver(forName: .NSMetadataQueryDidFinishGathering, object: query, queue: .main) { [self] _ in
      query.disableUpdates()
      let names = query.results.compactMap { ($0 as? NSMetadataItem)?.value(forAttribute: NSMetadataItemFSNameKey) as? String }
      finish(.success(names))
    }
    if !query.start() {
      finish(.failure(NSError(domain: "Solidarity.CloudSync", code: 1)))
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [self] in
      finish(.failure(NSError(domain: "Solidarity.CloudSync", code: 2)))
    }
  }

  private func finish(_ result: Result<[String], Error>) {
    guard let completion else { return }
    self.completion = nil
    query.stop()
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = nil
    completion(result)
  }
}
