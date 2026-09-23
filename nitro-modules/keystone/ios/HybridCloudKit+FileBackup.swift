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
      let cloudNames = (try? await BackupMetadataQuery.names(in: dir)) ?? []
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

  // MARK: - iCloud transfer state

  /// Whether `filename` can be read right now and, when it cannot, how far
  /// iCloud has got with fetching it. `readFileBackup` fails fast on a file
  /// that is not fully local so a sync pass never blocks an executor; this is
  /// what lets the JS side turn that failure into "downloading, 42%" and poll,
  /// instead of reporting the archive as unreadable.
  func getFileBackupDownloadState(filename: String) throws -> Promise<FileBackupDownloadState> {
    return Promise.async {
      let file = try self.checkedBackupFile(filename)
      let logicalExists = FileManager.default.fileExists(atPath: file.url.path)
      guard file.isICloud else {
        return FileBackupDownloadState(
          status: logicalExists ? .local : .missing, percentDownloaded: nil, errorMessage: nil)
      }
      // Fast path — no Spotlight round trip for a file that is already here.
      // Same polarity as `readFileBackup`: an ABSENT status means the daemon
      // does not track the item (yet) and the bytes are local — the archive
      // this device just wrote is the everyday case. Only a status that says
      // "not current" may fall through to the transfer probe.
      if logicalExists {
        let status = (try? file.url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]))?
          .ubiquitousItemDownloadingStatus
        if status == nil || status == .current {
          return FileBackupDownloadState(status: .current, percentDownloaded: 100, errorMessage: nil)
        }
      }
      // Spotlight is the only source of transfer progress. Bounded; when it
      // stalls, fall back to what the file system alone can say.
      let directory = file.url.deletingLastPathComponent()
      if let row = (try? await BackupMetadataQuery.attributes(of: filename, in: directory)) ?? nil {
        return Self.downloadState(from: row)
      }
      let placeholderExists = FileManager.default.fileExists(atPath: self.placeholderURL(for: file.url).path)
      guard logicalExists || placeholderExists else {
        return FileBackupDownloadState(status: .missing, percentDownloaded: nil, errorMessage: nil)
      }
      let values = try? file.url.resourceValues(
        forKeys: [.ubiquitousItemIsDownloadingKey, .ubiquitousItemDownloadingErrorKey])
      return FileBackupDownloadState(
        status: (values?.ubiquitousItemIsDownloading ?? false) ? .downloading : .notdownloaded,
        percentDownloaded: nil,
        errorMessage: values?.ubiquitousItemDownloadingError?.localizedDescription)
    }
  }

  /// Ask iCloud to fetch `filename` onto this device. Idempotent: a transfer
  /// already in flight is left alone. Local-only storage has nothing to fetch.
  func startFileBackupDownload(filename: String) throws -> Promise<Void> {
    return Promise.async {
      let file = try self.checkedBackupFile(filename)
      guard file.isICloud else { return }
      try FileManager.default.startDownloadingUbiquitousItem(at: file.url)
    }
  }

  private static func downloadState(from row: BackupMetadataAttributes) -> FileBackupDownloadState {
    if row.downloadingStatus == NSMetadataUbiquitousItemDownloadingStatusCurrent {
      return FileBackupDownloadState(status: .current, percentDownloaded: 100, errorMessage: nil)
    }
    return FileBackupDownloadState(
      status: row.isDownloading ? .downloading : .notdownloaded,
      percentDownloaded: row.percentDownloaded,
      errorMessage: row.downloadingError)
  }
}


/// The attributes this file reads from a Spotlight row. Copied out while the
/// query is still alive — `NSMetadataItem` values are only valid before
/// `stop()`.
private struct BackupMetadataAttributes {
  let name: String?
  let downloadingStatus: String?
  let isDownloading: Bool
  let percentDownloaded: Double?
  let downloadingError: String?

  init(_ item: NSMetadataItem) {
    name = item.value(forAttribute: NSMetadataItemFSNameKey) as? String
    downloadingStatus = item.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String
    isDownloading = (item.value(forAttribute: NSMetadataUbiquitousItemIsDownloadingKey) as? Bool) ?? false
    percentDownloaded = item.value(forAttribute: NSMetadataUbiquitousItemPercentDownloadedKey) as? Double
    downloadingError =
      (item.value(forAttribute: NSMetadataUbiquitousItemDownloadingErrorKey) as? NSError)?.localizedDescription
  }
}

/// One-shot NSMetadataQuery. Directory enumeration alone misses cloud-only
/// documents, and nothing but Spotlight reports transfer progress. The query
/// lives on the main run loop, with a bounded lifetime.
private final class BackupMetadataQuery {
  private let query = NSMetadataQuery()
  private var observer: NSObjectProtocol?
  private var completion: ((Result<[BackupMetadataAttributes], Error>) -> Void)?
  private var deadline: DispatchWorkItem?

  /// Every ubiquitous document under `directory`.
  static func names(in directory: URL) async throws -> [String] {
    return try await gather(
      format: "%K BEGINSWITH %@",
      arguments: [NSMetadataItemPathKey, directory.path + "/"],
      timeout: 10
    ).compactMap { $0.name }
  }

  /// The single document `filename` under `directory`, or nil when Spotlight
  /// has no row for it yet. Shorter timeout: this is polled by a progress UI.
  static func attributes(of filename: String, in directory: URL) async throws -> BackupMetadataAttributes? {
    return try await gather(
      format: "%K == %@ AND %K BEGINSWITH %@",
      arguments: [NSMetadataItemFSNameKey, filename, NSMetadataItemPathKey, directory.path + "/"],
      timeout: 3
    ).first
  }

  /// The predicate is built on the main queue from Sendable parts: an
  /// `NSPredicate` captured across the hop would be a non-Sendable capture.
  private static func gather(
    format: String,
    arguments: [String],
    timeout: TimeInterval
  ) async throws -> [BackupMetadataAttributes] {
    try await withCheckedThrowingContinuation { continuation in
      DispatchQueue.main.async {
        let listing = BackupMetadataQuery()
        listing.start(format: format, arguments: arguments, timeout: timeout) {
          continuation.resume(with: $0)
        }
      }
    }
  }

  private func start(
    format: String,
    arguments: [String],
    timeout: TimeInterval,
    completion: @escaping (Result<[BackupMetadataAttributes], Error>) -> Void
  ) {
    self.completion = completion
    query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
    query.predicate = NSPredicate(format: format, argumentArray: arguments)
    observer = NotificationCenter.default.addObserver(forName: .NSMetadataQueryDidFinishGathering, object: query, queue: .main) { [self] _ in
      query.disableUpdates()
      let rows = query.results.compactMap { ($0 as? NSMetadataItem).map(BackupMetadataAttributes.init) }
      finish(.success(rows))
    }
    if !query.start() {
      finish(.failure(NSError(domain: "Solidarity.CloudSync", code: 1)))
      return
    }
    // Cancelled in `finish`: a query that answered must not stay alive (and
    // retained) for the rest of its timeout — the progress UI polls this
    // every couple of seconds for the whole transfer.
    let deadline = DispatchWorkItem { [self] in
      finish(.failure(NSError(domain: "Solidarity.CloudSync", code: 2)))
    }
    self.deadline = deadline
    DispatchQueue.main.asyncAfter(deadline: .now() + timeout, execute: deadline)
  }

  private func finish(_ result: Result<[BackupMetadataAttributes], Error>) {
    guard let completion else { return }
    self.completion = nil
    deadline?.cancel()
    deadline = nil
    query.stop()
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = nil
    completion(result)
  }
}
