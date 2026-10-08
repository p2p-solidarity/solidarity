//
//  HybridCloudKit.swift
//  @solidarity/nitro-cloudkit (iOS)
//
//  Wraps Apple CloudKit behind the Nitrogen-generated HybridCloudKitSpec.
//  This is the cross-platform mirror of the Drive-backed Android impl, so
//  callers in JS hit the same `getCloudKit()` surface regardless of OS.
//
//  Responsibility split:
//    - This file: container lifecycle + record CRUD + share CRUD + the
//      delegate proxy for CKContainer.sharingDelegate. Hand-written; the
//      rest of the Nitro plumbing is generated under nitrogen/.
//    - `HybridCloudKit+Mapping.swift`: helpers translating between
//      `CloudKitRecord` (Nitro struct, fields-as-JSON) ↔ `CKRecord`.
//    - `HybridCloudKit+Events.swift`: subscription + listener fan-out.
//
//  Threading: every public method is async via Promise.async, but the
//  shared mutable state (`listeners`, `recordIdToZone`, etc.) is guarded
//  by a serial DispatchQueue (`stateQueue`) so concurrent CK callbacks
//  can't tear the maps. CloudKit itself dispatches its callbacks on
//  arbitrary GCD queues; we just trampoline through `stateQueue`.
//
//  Security:
//    - We do not log record bodies (PII risk). Only record IDs + types.
//    - We do not force-unwrap (`!`) any CloudKit optionals — every
//      `CKRecord` lookup returns Result via `Promise.async`'s throw.
//    - iCloud account status is rechecked on every initialize() call so
//      the JS layer can react to sign-out without restarting the app.
//

import CloudKit
import Foundation
import NitroModules

final class HybridCloudKit: HybridCloudKitSpec {

  // MARK: - Stored state (serialised through stateQueue)

  /// Set by `initialize()`. We default to the bundle's automatic container
  /// (`CKContainer.default()`) when the JS caller passes the empty string,
  /// matching the legacy Swift app's behaviour.
  internal var container: CKContainer?
  internal var privateDatabase: CKDatabase?
  internal var sharedDatabase: CKDatabase?

  /// Active subscriptions, keyed by subscription ID so we can revoke them on
  /// teardown. CKDatabaseSubscription is one-per-database, but we add a
  /// CKQuerySubscription per record type as listeners are attached.
  internal var subscriptions: [String: CKSubscription] = [:]

  /// Default zone for private records. We mirror the legacy Swift app's
  /// "AirMeishiGroups" custom zone so records produced by the v1.3.x Swift
  /// build remain reachable from the Expo client.
  internal let defaultZoneName = "AirMeishiGroups"
  internal var customZoneCreated = false

  /// Record-id → zone-id cache. Populated on save / fetch so subsequent
  /// updates and deletes route to the right zone without re-querying.
  internal var recordIdToZone: [String: CKRecordZone.ID] = [:]
  /// Record-id → share-id cache. Used so `delete` can also clean up the
  /// `recordIdToShare` reverse-lookup on the same call site.
  internal var recordIdToShare: [String: String] = [:]
  /// Share-id → root-record-id (we cache so `fetchSharedRecords` can pull
  /// the hierarchy without another network round-trip).
  internal var shareIdToRoot: [String: String] = [:]

  /// Event-listener fan-out. UUID keys so unsubscribe stays O(1).
  internal var listeners: [UUID: (CloudKitEvent) -> Void] = [:]

  internal let stateQueue = DispatchQueue(label: "gg.solidarity.cloudkit.state")

  /// CKContainer notification token. Stored so we can deregister cleanly
  /// when the HybridObject is GC'd; CloudKit retains it strongly otherwise.
  internal var accountChangeObserver: NSObjectProtocol?

  // MARK: - Helpers

  @inline(__always)
  internal func withState<T>(_ body: () -> T) -> T { stateQueue.sync(execute: body) }

  internal func emit(_ event: CloudKitEvent) {
    let snapshot = withState { Array(self.listeners.values) }
    for handler in snapshot { handler(event) }
  }

  internal func emitError(_ message: String, code: String) {
    emit(makeEvent(.error, errorMessage: message, errorCode: code))
  }

  internal func makeEvent(
    _ kind: CloudKitEventKind,
    recordId: String? = nil,
    recordType: String? = nil,
    shareId: String? = nil,
    errorMessage: String? = nil,
    errorCode: String? = nil
  ) -> CloudKitEvent {
    CloudKitEvent(
      kind: kind, recordId: recordId, recordType: recordType, shareId: shareId,
      errorMessage: errorMessage, errorCode: errorCode
    )
  }

  internal func zoneIdForRecord(_ recordId: String) -> CKRecordZone.ID {
    if let zone = withState({ self.recordIdToZone[recordId] }) {
      return zone
    }
    return CKRecordZone.ID(zoneName: defaultZoneName, ownerName: CKCurrentUserDefaultName)
  }

  // MARK: - Container lifecycle

  func initialize(containerIdentifier: String) throws -> Promise<Bool> {
    return Promise.async {
      let resolvedContainer: CKContainer
      if containerIdentifier.isEmpty {
        resolvedContainer = CKContainer.default()
      } else {
        resolvedContainer = CKContainer(identifier: containerIdentifier)
      }
      self.withState {
        self.container = resolvedContainer
        self.privateDatabase = resolvedContainer.privateCloudDatabase
        self.sharedDatabase = resolvedContainer.sharedCloudDatabase
      }
      let status = try await resolvedContainer.accountStatus()
      let available = (status == .available)
      if available {
        // Best-effort zone creation. We swallow errors here because the
        // zone may already exist; subsequent save calls will surface any
        // *real* failures.
        do {
          try await self.ensureCustomZone()
        } catch {
          // No PII in this log — only the localised error description.
          NSLog("[Solidarity-CloudKit] zone setup note: %@", error.localizedDescription)
        }
        self.registerAccountChangeObserver()
      }
      return available
    }
  }

  func isAvailable() throws -> Bool {
    return withState { self.container != nil }
  }

  func currentUserId() throws -> Promise<String> {
    return Promise.async {
      guard let container = self.withState({ self.container }) else {
        throw self.error("not_initialized", "Container has not been initialized")
      }
      let recordID = try await container.userRecordID()
      return recordID.recordName
    }
  }

  internal func ensureCustomZone() async throws {
    guard let privateDB = withState({ self.privateDatabase }),
      withState({ !self.customZoneCreated })
    else { return }
    let zone = CKRecordZone(
      zoneID: CKRecordZone.ID(zoneName: defaultZoneName, ownerName: CKCurrentUserDefaultName)
    )
    _ = try await privateDB.save(zone)
    withState { self.customZoneCreated = true }
  }

  // MARK: - Private DB CRUD

  func saveRecord(record: CloudKitRecord) throws -> Promise<CloudKitRecord> {
    return Promise.async {
      guard let db = self.withState({ self.privateDatabase }) else {
        throw self.error("not_initialized", "Container has not been initialized")
      }
      try await self.ensureCustomZone()
      let zoneId: CKRecordZone.ID
      if let explicit = record.zoneId, !explicit.isEmpty {
        zoneId = CKRecordZone.ID(zoneName: explicit, ownerName: CKCurrentUserDefaultName)
      } else {
        zoneId = CKRecordZone.ID(zoneName: self.defaultZoneName, ownerName: CKCurrentUserDefaultName)
      }
      let ckRecord = try self.makeCkRecord(from: record, in: zoneId)
      let saved = try await db.save(ckRecord)
      self.withState {
        self.recordIdToZone[saved.recordID.recordName] = zoneId
      }
      self.emit(self.makeEvent(.recordsaved, recordId: saved.recordID.recordName, recordType: saved.recordType))
      return try self.makeNitroRecord(from: saved)
    }
  }

  func fetchRecord(recordId: String) throws -> Promise<CloudKitRecord> {
    return Promise.async {
      guard let db = self.withState({ self.privateDatabase }) else {
        throw self.error("not_initialized", "Container has not been initialized")
      }
      let zoneId = self.zoneIdForRecord(recordId)
      let id = CKRecord.ID(recordName: recordId, zoneID: zoneId)
      let record = try await db.record(for: id)
      return try self.makeNitroRecord(from: record)
    }
  }

  func deleteRecord(recordId: String) throws -> Promise<Void> {
    return Promise.async {
      guard let db = self.withState({ self.privateDatabase }) else {
        throw self.error("not_initialized", "Container has not been initialized")
      }
      let zoneId = self.zoneIdForRecord(recordId)
      let id = CKRecord.ID(recordName: recordId, zoneID: zoneId)
      _ = try await db.deleteRecord(withID: id)
      self.withState {
        self.recordIdToZone.removeValue(forKey: recordId)
        self.recordIdToShare.removeValue(forKey: recordId)
      }
      self.emit(self.makeEvent(.recorddeleted, recordId: recordId))
    }
  }

  func queryRecords(recordType: String, predicateJson: String) throws -> Promise<[CloudKitRecord]> {
    return Promise.async {
      guard let db = self.withState({ self.privateDatabase }) else {
        throw self.error("not_initialized", "Container has not been initialized")
      }
      let predicate = self.predicate(fromJson: predicateJson)
      let query = CKQuery(recordType: recordType, predicate: predicate)
      let zoneId = CKRecordZone.ID(zoneName: self.defaultZoneName, ownerName: CKCurrentUserDefaultName)
      let (matchResults, _) = try await db.records(matching: query, inZoneWith: zoneId)
      var out: [CloudKitRecord] = []
      out.reserveCapacity(matchResults.count)
      for (_, result) in matchResults {
        if case .success(let record) = result {
          if let mapped = try? self.makeNitroRecord(from: record) { out.append(mapped) }
        }
      }
      return out
    }
  }

  // MARK: - Shared DB / CKShare

  func createShare(rootRecordId: String, title: String, allowsPublicAccess: Bool) throws -> Promise<CloudKitShareInvite> {
    return Promise.async {
      guard let db = self.withState({ self.privateDatabase }) else {
        throw self.error("not_initialized", "Container has not been initialized")
      }
      let zoneId = self.zoneIdForRecord(rootRecordId)
      let recordId = CKRecord.ID(recordName: rootRecordId, zoneID: zoneId)
      let rootRecord = try await db.record(for: recordId)

      // If a share already exists, hand back its URL instead of failing.
      if let existingRef = rootRecord.share {
        if let existingShare = try await db.record(for: existingRef.recordID) as? CKShare,
          let url = existingShare.url
        {
          let shareId = existingShare.recordID.recordName
          self.withState {
            self.shareIdToRoot[shareId] = rootRecordId
            self.recordIdToShare[rootRecordId] = shareId
          }
          return CloudKitShareInvite(
            shareId: shareId, url: url.absoluteString, title: title, thumbnail: nil
          )
        }
      }

      let share = CKShare(rootRecord: rootRecord)
      share[CKShare.SystemFieldKey.title] = title as CKRecordValue
      share.publicPermission = allowsPublicAccess ? .readWrite : .none

      try await self.modify(records: [rootRecord, share], in: db)
      guard let url = share.url else {
        throw self.error(
          "share_no_url",
          "CKShare saved but no URL was assigned by CloudKit"
        )
      }
      let shareId = share.recordID.recordName
      self.withState {
        self.shareIdToRoot[shareId] = rootRecordId
        self.recordIdToShare[rootRecordId] = shareId
      }
      return CloudKitShareInvite(
        shareId: shareId, url: url.absoluteString, title: title, thumbnail: nil
      )
    }
  }

  func acceptShare(url: String) throws -> Promise<String> {
    return Promise.async {
      guard let container = self.withState({ self.container }) else {
        throw self.error("not_initialized", "Container has not been initialized")
      }
      guard let shareUrl = URL(string: url) else {
        throw self.error("bad_share_url", "Share URL is not a valid URL")
      }
      let metadata = try await container.shareMetadata(for: shareUrl)
      try await container.accept(metadata)
      let shareId = metadata.share.recordID.recordName
      self.emit(self.makeEvent(.shareaccepted, shareId: shareId))
      return shareId
    }
  }

  func fetchSharedRecords(shareId: String) throws -> Promise<[CloudKitRecord]> {
    return Promise.async {
      guard let db = self.withState({ self.sharedDatabase }) else {
        throw self.error("not_initialized", "Container has not been initialized")
      }
      // shareDB queries are scoped by the system; predicate is honoured but
      // results are pre-filtered by CKShare membership.
      let query = CKQuery(recordType: "CD_AirmeishiGroupRecord", predicate: NSPredicate(value: true))
      let (matchResults, _) = try await db.records(matching: query)
      var out: [CloudKitRecord] = []
      out.reserveCapacity(matchResults.count)
      for (_, result) in matchResults {
        if case .success(let record) = result {
          if let mapped = try? self.makeNitroRecord(from: record, shareId: shareId) {
            out.append(mapped)
          }
        }
      }
      return out
    }
  }

  func removeShare(shareId: String) throws -> Promise<Void> {
    return Promise.async {
      guard let db = self.withState({ self.privateDatabase }) else {
        throw self.error("not_initialized", "Container has not been initialized")
      }
      let zoneId = CKRecordZone.ID(zoneName: self.defaultZoneName, ownerName: CKCurrentUserDefaultName)
      let id = CKRecord.ID(recordName: shareId, zoneID: zoneId)
      _ = try await db.deleteRecord(withID: id)
      self.withState {
        if let root = self.shareIdToRoot.removeValue(forKey: shareId) {
          self.recordIdToShare.removeValue(forKey: root)
        }
      }
      self.emit(self.makeEvent(.sharerevoked, shareId: shareId))
    }
  }

  // MARK: - Event listener

  func addEventListener(handler: @escaping (CloudKitEvent) -> Void) throws -> () -> Void {
    let id = UUID()
    withState { self.listeners[id] = handler }
    return { [weak self] in
      self?.withState { self?.listeners.removeValue(forKey: id) }
    }
  }

  // MARK: - Drive token (no-op on iOS)

  func setDriveAccessToken(accessToken: String) throws {
    // iOS authenticates via the system iCloud account; ignore the token.
    _ = accessToken
  }

  // MARK: - Helpers private to this file

  internal func error(_ code: String, _ message: String) -> NSError {
    return NSError(
      domain: "gg.solidarity.cloudkit",
      code: 0,
      userInfo: [
        NSLocalizedDescriptionKey: message,
        "errorCode": code,
      ]
    )
  }

  internal func modify(records: [CKRecord], in db: CKDatabase) async throws {
    let op = CKModifyRecordsOperation(recordsToSave: records, recordIDsToDelete: nil)
    op.savePolicy = .changedKeys
    op.qualityOfService = .userInitiated
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      op.modifyRecordsResultBlock = { result in
        switch result {
        case .success: cont.resume(returning: ())
        case .failure(let err): cont.resume(throwing: err)
        }
      }
      db.add(op)
    }
  }

  internal func registerAccountChangeObserver() {
    if accountChangeObserver != nil { return }
    accountChangeObserver = NotificationCenter.default.addObserver(
      forName: .CKAccountChanged,
      object: nil, queue: .main
    ) { [weak self] _ in
      self?.emit(self?.makeEvent(.accountchanged) ?? CloudKitEvent(
        kind: .accountchanged, recordId: nil, recordType: nil,
        shareId: nil, errorMessage: nil, errorCode: nil
      ))
    }
  }

  deinit {
    if let observer = accountChangeObserver {
      NotificationCenter.default.removeObserver(observer)
    }
  }
}
