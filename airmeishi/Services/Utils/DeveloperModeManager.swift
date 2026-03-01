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
        title: "Developer Mode Enabled",
        message: "Group management and Sakura gallery are now accessible in Settings.",
        type: .success,
        duration: 3.0
      )
    } else if tapCount >= 5 {
      let remaining = DeveloperModeManager.threshold - tapCount
      ToastManager.shared.show(
        title: "Almost there...",
        message: "\(remaining) tap\(remaining == 1 ? "" : "s") away from developer mode.",
        type: .info,
        duration: 1.5
      )
    }
  }

  func disableDeveloperMode() {
    isDeveloperMode = false
    tapCount = 0

    ToastManager.shared.show(
      title: "Developer Mode Disabled",
      message: nil,
      type: .info,
      duration: 2.0
    )
  }
}
