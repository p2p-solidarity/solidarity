import UIKit
import UserNotifications

class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        
        // 1. Register Push Notification Permissions
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
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
    }

    // D. Receive Message - Silent Push Handling (Background Fetch)
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable : Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        
        // Check if it is a silent push (content-available: 1)
        guard let aps = userInfo["aps"] as? [String: Any],
              let contentAvailable = aps["content-available"] as? Int,
              contentAvailable == 1 else {
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
