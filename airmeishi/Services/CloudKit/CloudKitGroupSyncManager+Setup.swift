//
//  CloudKitGroupSyncManager+Setup.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import CloudKit
import Combine
import Foundation

extension CloudKitGroupSyncManager {

  func checkAccountStatus() async {
    do {
      accountStatus = try await container.accountStatus()
      switch accountStatus {
      case .available:
        let id = try await container.userRecordID()
        self.currentUserRecordID = id
        self.isAuthenticated = true
      default:
        self.isAuthenticated = false
        self.currentUserRecordID = nil
      }
    } catch {
      print("Error checking account status: \(error)")
      self.isAuthenticated = false
      self.accountStatus = .couldNotDetermine
    }
  }

  internal func createCustomZoneIfNeeded() async throws {
    do {
      let zone = CKRecordZone(zoneID: customZoneID)
      try await privateDB.save(zone)
      print("[CloudKitManager] Custom zone created/verified")
    } catch {
      // Ignore if already exists
      print("[CloudKitManager] Zone creation note: \(error)")
    }
  }

  internal func subscribeToChanges() async throws {
    // 1. Subscribe to Public Group Changes (Database Subscription not available for Public DB, use Query)
    // Subscribe to all group memberships for this user
    if let userID = currentUserRecordID {
      let predicate = NSPredicate(format: "userRecordID == %@", userID)
      let subscriptionID = "group-membership-changes"
      let subscription = CKQuerySubscription(
        recordType: CloudKitRecordType.groupMembership,
        predicate: predicate,
        subscriptionID: subscriptionID,
        options: [.firesOnRecordCreation, .firesOnRecordUpdate, .firesOnRecordDeletion]
      )

      let notificationInfo = CKSubscription.NotificationInfo()
      notificationInfo.shouldSendContentAvailable = true  // Silent push
      subscription.notificationInfo = notificationInfo

      _ = try? await publicDB.save(subscription)
      print("[CloudKitManager] Subscribed to public group membership changes")
    }

    // 2. Subscribe to Private/Shared Database Changes
    let privateSubscription = CKDatabaseSubscription(subscriptionID: "private-changes")
    let privateNotificationInfo = CKSubscription.NotificationInfo()
    privateNotificationInfo.shouldSendContentAvailable = true
    privateSubscription.notificationInfo = privateNotificationInfo
    _ = try? await privateDB.save(privateSubscription)

    let sharedSubscription = CKDatabaseSubscription(subscriptionID: "shared-changes")
    let sharedNotificationInfo = CKSubscription.NotificationInfo()
    sharedNotificationInfo.shouldSendContentAvailable = true
    sharedSubscription.notificationInfo = sharedNotificationInfo
    _ = try? await sharedDB.save(sharedSubscription)

    print("[CloudKitManager] Subscribed to private/shared database changes")
  }
}
