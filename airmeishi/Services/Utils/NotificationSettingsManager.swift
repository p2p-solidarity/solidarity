//
//  NotificationSettingsManager.swift
//  airmeishi
//
//  Centralized notification preferences manager for Sakura messages
//

import Combine
import Foundation
import SwiftUI

class NotificationSettingsManager: ObservableObject {
  static let shared = NotificationSettingsManager()

  // MARK: - Storage Keys

  private enum Keys {
    static let enableInAppToast = "notification.enableInAppToast"
    static let enableRemoteNotification = "notification.enableRemoteNotification"
    static let enableAutoSync = "notification.enableAutoSync"
    static let syncIntervalSeconds = "notification.syncIntervalSeconds"
  }

  // MARK: - Default Values

  private enum Defaults {
    static let enableInAppToast = true
    static let enableRemoteNotification = true
    static let enableAutoSync = true
    static let syncIntervalSeconds = 30  // 30 seconds default (was 5)
  }

  // MARK: - Published Properties

  /// Show toast notification when sakura message arrives (app in foreground)
  @Published var enableInAppToast: Bool {
    didSet {
      UserDefaults.standard.set(enableInAppToast, forKey: Keys.enableInAppToast)
    }
  }

  /// Allow APNs to show system banner (when app in background/closed)
  @Published var enableRemoteNotification: Bool {
    didSet {
      UserDefaults.standard.set(enableRemoteNotification, forKey: Keys.enableRemoteNotification)
    }
  }

  /// Enable background sync/polling for messages (mainly for simulator)
  @Published var enableAutoSync: Bool {
    didSet {
      UserDefaults.standard.set(enableAutoSync, forKey: Keys.enableAutoSync)
      // Notify MessageService to start/stop polling
      NotificationCenter.default.post(
        name: .autoSyncSettingChanged,
        object: nil,
        userInfo: ["enabled": enableAutoSync]
      )
    }
  }

  /// Polling interval in seconds (default 30s)
  @Published var syncIntervalSeconds: Int {
    didSet {
      UserDefaults.standard.set(syncIntervalSeconds, forKey: Keys.syncIntervalSeconds)
    }
  }

  // MARK: - Initialization

  private init() {
    let defaults = UserDefaults.standard

    // Load saved values or use defaults
    if defaults.object(forKey: Keys.enableInAppToast) != nil {
      self.enableInAppToast = defaults.bool(forKey: Keys.enableInAppToast)
    } else {
      self.enableInAppToast = Defaults.enableInAppToast
    }

    if defaults.object(forKey: Keys.enableRemoteNotification) != nil {
      self.enableRemoteNotification = defaults.bool(forKey: Keys.enableRemoteNotification)
    } else {
      self.enableRemoteNotification = Defaults.enableRemoteNotification
    }

    if defaults.object(forKey: Keys.enableAutoSync) != nil {
      self.enableAutoSync = defaults.bool(forKey: Keys.enableAutoSync)
    } else {
      self.enableAutoSync = Defaults.enableAutoSync
    }

    let storedInterval = defaults.integer(forKey: Keys.syncIntervalSeconds)
    self.syncIntervalSeconds = storedInterval > 0 ? storedInterval : Defaults.syncIntervalSeconds
  }

  // MARK: - Convenience Methods

  /// Available sync interval options for UI picker
  static let syncIntervalOptions: [(label: String, seconds: Int)] = [
    ("15 seconds", 15),
    ("30 seconds", 30),
    ("1 minute", 60),
    ("5 minutes", 300),
  ]

  /// Reset all settings to defaults
  func resetToDefaults() {
    enableInAppToast = Defaults.enableInAppToast
    enableRemoteNotification = Defaults.enableRemoteNotification
    enableAutoSync = Defaults.enableAutoSync
    syncIntervalSeconds = Defaults.syncIntervalSeconds
  }
}

// MARK: - Notification Names

extension Notification.Name {
  static let autoSyncSettingChanged = Notification.Name("autoSyncSettingChanged")
}
