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
                // 1. Pull (Sync)
                let messages = try await MessageService.shared.syncMessages()
                if messages.isEmpty {
                    completionHandler(.noData)
                    return
                }

                var processedIds: [String] = []

                for msg in messages {
                    // 2. Decrypt (Note: Need to know who the Sender is,
                    // To simplify, you might need to attach Sender PubKey before the Blob,
                    // Or try to match owner_pubkey in Contact list)
                    // Assuming you can map owner_pubkey to address book
                    
                    if let senderContact = findContact(pubKey: msg.owner_pubkey) {
                        let decryptedText = try SecureKeyManager.shared.decrypt(
                            blobBase64: msg.blob,
                            from: senderContact.pubKey // Unwrap using sender's PubKey
                        )
                        
                        // 3. Local Notification
                        showLocalNotification(text: decryptedText, sender: senderContact.name)
                        processedIds.append(msg.id)
                    }
                }

                // 4. Destroy (Ack)
                await MessageService.shared.ackMessages(ids: processedIds)
                
                completionHandler(.newData)
            } catch {
                print("Sync failed: \(error)")
                completionHandler(.failed)
            }
        }
    }
    
    // Helper: Show Local Notification
    func showLocalNotification(text: String, sender: String) {
        let content = UNMutableNotificationContent()
        content.title = sender
        content.body = text
        content.sound = .default
        
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
    
    // Mock Data Helper: Find Contact
    func findContact(pubKey: String) -> SecureContact? {
        // Implementation: Query from CoreData/Realm
        // Returning mock data for now
        return SecureContact(name: "Alice", pubKey: pubKey, signPubKey: "...", sealedRoute: "...")
    }
}
