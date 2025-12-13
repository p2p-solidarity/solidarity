import CloudKit
import UIKit
import UserNotifications

class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {

    // 1. Register Push Notification Permissions
    UNUserNotificationCenter.current().delegate = self
    UNUserNotificationCenter.current()
      .requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
        if granted {
          DispatchQueue.main.async {
            application.registerForRemoteNotifications()
          }
        }
      }
    return true
  }

  // A. Initialization - Get Device Token
  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    #if !targetEnvironment(simulator)
      let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
      print("[AppDelegate] Device token: \(tokenString)")
      // Validate token format to ensure it's not a fallback or malformed
      guard !tokenString.isEmpty,
        !tokenString.contains("simulator_dummy_token"),
        !tokenString.contains("fallback")
      else {
        print("[AppDelegate] Invalid or fallback token detected on device. Ignoring.")
        return
      }

      Task {
        do {
          // 2. Exchange for Envelope (Seal)
          let sealedRoute = try await MessageService.shared.sealToken(deviceToken: tokenString)

          // 3. Save Business Card (Update Local Storage)
          SecureKeyManager.shared.mySealedRoute = sealedRoute
          print("My Route Sealed: \(sealedRoute)")

          // UI can now display QR Code containing: Name + PubKey + SealedRoute
        } catch {
          print("Failed to seal token: \(error)")
        }
      }
    #else
      print("[AppDelegate] Simulator detected. Skipping APNs token registration in favor of fallback.")
    #endif
  }

  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    print("[AppDelegate] Failed to register for remote notifications: \(error)")
    // Clear any existing sealed route to prevent using a stale or invalid one
    SecureKeyManager.shared.mySealedRoute = nil
  }

  // D. Receive Message - Silent Push Handling (Background Fetch)
  func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {

    // 1. Check for CloudKit Notification
    if let notification = CKNotification(fromRemoteNotificationDictionary: userInfo) {
      print("[AppDelegate] Received CloudKit notification: \(notification)")

      if notification.subscriptionID == "private-changes" || notification.subscriptionID == "shared-changes"
        || notification.notificationType == .query
      {

        Task {
          do {
            try await CloudKitGroupSyncManager.shared.fetchLatestChanges()
            completionHandler(.newData)
          } catch {
            print("[AppDelegate] CloudKit sync failed: \(error)")
            completionHandler(.failed)
          }
        }
        return
      }
    }

    // 2. Check for Silent Push (content-available: 1) for MessageService
    guard let aps = userInfo["aps"] as? [String: Any],
      let contentAvailable = aps["content-available"] as? Int,
      contentAvailable == 1
    else {
      completionHandler(.noData)
      return
    }

    Task {
      do {
        // Use shared logic in MessageService
        let hasNewData = try await MessageService.shared.processIncomingMessages()
        completionHandler(hasNewData ? .newData : .noData)
      } catch {
        print("Sync failed: \(error)")
        completionHandler(.failed)
      }
    }
  }
}

extension AppDelegate {
  // Delegate already set in application(_:didFinishLaunchingWithOptions:)

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    #if canImport(UIKit)
      let state = UIApplication.shared.applicationState
    #else
      let state: UIApplication.State = .inactive
    #endif

    let userInfo = notification.request.content.userInfo

    // Special handling only for Sakura backend pushes (containing message_id)
    if state == .active, userInfo["message_id"] != nil {
      // Foreground: Suppress system banner / sound
      completionHandler([])

      // Trigger sync + decrypt immediately -> MessageService posts .secureMessageReceived
      Task {
        do {
          _ = try await MessageService.shared.processIncomingMessages()
        } catch {
          print("[AppDelegate] Failed to process incoming Sakura messages: \(error)")
        }
      }
    } else {
      // Other cases (Background / Lock Screen / Other notification types): Show system notification normally
      completionHandler([.banner, .sound, .badge])
    }
  }
}
