//
//  SolidarityApp.swift
//  solidarity
//
//  Created by kidneyweak on 2025/09/09.
//

import Foundation
import AppIntents
import PassKit
import SwiftUI

@main
struct SolidarityApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

  // Initialize core managers
  @StateObject private var cardManager = CardManager.shared
  @StateObject private var contactRepository = ContactRepository.shared
  @StateObject private var proximityManager = ProximityManager.shared
  @StateObject private var deepLinkManager = DeepLinkManager.shared
  @StateObject private var themeManager = ThemeManager.shared
  @StateObject private var identityDataStore = IdentityDataStore.shared
  @StateObject private var identityCoordinator = IdentityCoordinator.shared

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(cardManager)
        .environmentObject(contactRepository)
        .environmentObject(proximityManager)
        .environmentObject(deepLinkManager)
        .environmentObject(themeManager)
        .environmentObject(identityDataStore)
        .environmentObject(identityCoordinator)
        .preferredColorScheme(themeManager.appColorScheme.colorScheme)
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
    // MARK: - UIAppearance (Adaptive)

    let tabBarAppearance = UITabBarAppearance()
    tabBarAppearance.configureWithDefaultBackground()
    UITabBar.appearance().standardAppearance = tabBarAppearance
    UITabBar.appearance().scrollEdgeAppearance = tabBarAppearance

    let navBarAppearance = UINavigationBarAppearance()
    navBarAppearance.configureWithDefaultBackground()
    UINavigationBar.appearance().standardAppearance = navBarAppearance
    UINavigationBar.appearance().scrollEdgeAppearance = navBarAppearance
    UINavigationBar.appearance().compactAppearance = navBarAppearance

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

    EncryptionManager.shared.migrateLegacyKeyIfNeeded()
    SemaphoreIdentityManager.shared.migrateLegacyIdentityIfNeeded()
    _ = IssuerTrustAnchorStore.shared

    identityDataStore.runInitialMigrationIfNeeded()

    // Note: Data is automatically loaded in the managers' init methods
    print("App setup completed")

    // Ensure we have a sealed route for Secure Messaging (Sakura)
    // If APNS fails or is not available (Simulator), we use a generated UUID
    // Ensure we have a sealed route for Secure Messaging (Sakura)
    // If APNS fails or is not available (Simulator), we use a generated UUID

    #if targetEnvironment(simulator)
      // On Simulator, we start polling because APNs is not available
      // Only start if auto-sync is enabled in settings
      if NotificationSettingsManager.shared.enableAutoSync {
        MessageService.shared.startPolling()
      }

      // Also, we force a fallback token update to ensure the backend has a valid token
      // even if one was previously saved (which might be stale or invalid "simulato")
      Task {
        do {
          // Use a consistent dummy token for this install
          let defaults = UserDefaults.standard
          let tokenKey = AppBranding.currentSimulatorDeviceTokenKey
          var dummyToken = defaults.string(forKey: tokenKey)

          if dummyToken == nil {
            dummyToken = "simulator_dummy_token_\(UUID().uuidString)"
            defaults.set(dummyToken, forKey: tokenKey)
          }

          if let token = dummyToken {
            #if DEBUG
            print("[App] Simulator detected. Sealing fallback token: \(token)")
            #endif
            let route = try await MessageService.shared.sealToken(deviceToken: token)
            SecureKeyManager.shared.mySealedRoute = route
            #if DEBUG
            print("[App] Fallback sealing successful. Route: \(route)")
            #endif
          }
        } catch {
          print("[App] Fallback sealing failed: \(error)")
        }
      }
    #else
      // On Device, we rely on AppDelegate's didRegisterForRemoteNotificationsWithDeviceToken
      // to obtain the real APNs token and seal it.
      // We do NOT generate a fallback token here to avoid race conditions where
      // a fallback token is generated before the real APNs token arrives.
      print("[App] Running on device. Waiting for APNs token registration...")

      // CRITICAL: Clear any potential "simulator" or "fallback" sealed route that might be persisted.
      // This ensures we ONLY use the real APNs token we are about to receive.
      SecureKeyManager.shared.mySealedRoute = nil

      // Also clear any stored simulator token from UserDefaults to be safe
      UserDefaults.standard.removeObject(forKey: AppBranding.currentSimulatorDeviceTokenKey)
      UserDefaults.standard.removeObject(forKey: AppBranding.legacySimulatorDeviceTokenKey)
    #endif
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
