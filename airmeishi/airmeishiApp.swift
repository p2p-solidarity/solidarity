//
//  airmeishiApp.swift
//  airmeishi
//
//  Created by kidneyweak on 2025/09/09.
//

import SwiftUI
import PassKit
import Foundation

@main
struct airmeishiApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    
    // Initialize core managers
    @StateObject private var cardManager = CardManager.shared
    @StateObject private var contactRepository = ContactRepository.shared
    @StateObject private var proximityManager = ProximityManager.shared
    @StateObject private var deepLinkManager = DeepLinkManager.shared
    @StateObject private var themeManager = ThemeManager.shared
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(cardManager)
                .environmentObject(contactRepository)
                .environmentObject(proximityManager)
                .environmentObject(deepLinkManager)
                .environmentObject(themeManager)
                .tint(.black)
                .preferredColorScheme(.dark)
                .onAppear {
                    setupApp()
                }
                .onOpenURL { url in
                    handleIncomingURL(url)
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { userActivity in
                    if let url = userActivity.webpageURL {
                        handleIncomingURL(url)
                    }
                }
        }
    }
    
    /// Initialize app components and check permissions
    private func setupApp() {
        // Check if PassKit is available
        if PKPassLibrary.isPassLibraryAvailable() {
            print("PassKit is available")
        } else {
            print("PassKit is not available on this device")
        }
        
        // Check storage availability
        if !StorageManager.shared.isStorageAvailable() {
            print("Warning: Storage is not available")
        }
        
        // Request necessary permissions
        requestPermissions()
        
        // Note: Data is automatically loaded in the managers' init methods
        print("App setup completed")
        
        // Ensure we have a sealed route for Secure Messaging (Sakura)
        // If APNS fails or is not available (Simulator), we use a generated UUID
        if SecureKeyManager.shared.mySealedRoute == nil {
            print("No sealed route found. Initiating fallback sealing...")
            Task {
                do {
                    let dummyToken = "fallback_token_\(UUID().uuidString)"
                    let route = try await MessageService.shared.sealToken(deviceToken: dummyToken)
                    SecureKeyManager.shared.mySealedRoute = route
                    print("Fallback sealing successful. Route: \(route)")
                } catch {
                    print("Fallback sealing failed: \(error)")
                }
            }
        }
    }
    
    /// Handle incoming URLs from various sources
    private func handleIncomingURL(_ url: URL) {
        print("🔗 [App] Received URL: \(url)")
        print("🔗 [App] URL scheme: \(url.scheme ?? "nil")")
        print("🔗 [App] URL host: \(url.host ?? "nil")")
        print("🔗 [App] URL path: \(url.path)")
        print("🔗 [App] URL query: \(url.query ?? "nil")")
        print("🔗 [App] URL absoluteString: \(url.absoluteString)")
        
        // Coinbase handling removed; rely on app deep link handling
        print("🔗 [App] Attempting DeepLinkManager handling...")
        let handledByDeepLink = deepLinkManager.handleIncomingURL(url)
        print("🔗 [App] DeepLinkManager result: \(handledByDeepLink)")
        
        let handled = handledByDeepLink
        print("🔗 [App] Overall handled: \(handled)")
        
        if !handled {
            print("❌ [App] Failed to handle URL: \(url)")
        } else {
            print("✅ [App] Successfully handled URL: \(url)")
        }
    }
    
    /// Request necessary permissions for proximity sharing
    private func requestPermissions() {
        // Proximity sharing permissions are handled automatically by MultipeerConnectivity
        // Contact permissions are requested when needed
        
        print("Permissions setup completed")
    }
}
