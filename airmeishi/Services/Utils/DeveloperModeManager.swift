//
//  DeveloperModeManager.swift
//  airmeishi
//
//  Manages developer mode activation via version-tap easter egg
//

import SwiftUI

@MainActor
final class DeveloperModeManager: ObservableObject {
  static let shared = DeveloperModeManager()

  @AppStorage("developerModeEnabled") var isDeveloperMode: Bool = false
  @AppStorage("dev.simulateNFC") var simulateNFC: Bool = true

  @Published var tapCount: Int = 0

  private static let threshold = 7

  private init() {}

  func registerVersionTap() {
    tapCount += 1

    if tapCount >= DeveloperModeManager.threshold {
      isDeveloperMode = true
      tapCount = 0

      #if canImport(UIKit)
      UINotificationFeedbackGenerator().notificationOccurred(.success)
      #endif

      ToastManager.shared.show(
        title: String(localized: "Developer Mode Enabled"),
        message: String(localized: "Group management and Sakura gallery are now accessible in Settings."),
        type: .success,
        duration: 3.0
      )
    } else if tapCount >= 5 {
      let remaining = DeveloperModeManager.threshold - tapCount
      ToastManager.shared.show(
        title: String(localized: "Almost there..."),
        message: remaining == 1
          ? String(localized: "1 tap away from developer mode.")
          : String(
            format: String(localized: "%lld taps away from developer mode."),
            locale: Locale.current,
            remaining
          ),
        type: .info,
        duration: 1.5
      )
    }
  }

  func disableDeveloperMode() {
    isDeveloperMode = false
    tapCount = 0

    ToastManager.shared.show(
      title: String(localized: "Developer Mode Disabled"),
      message: nil,
      type: .info,
      duration: 2.0
    )
  }
}
