//
//  HapticFeedbackManager.swift
//  solidarity
//

import UIKit

final class HapticFeedbackManager {
  static let shared = HapticFeedbackManager()

  private init() {}

  /// For standard neo-brutalist buttons (heavy, solid click)
  func heavyImpact() {
    let generator = UIImpactFeedbackGenerator(style: .heavy)
    generator.prepare()
    generator.impactOccurred()
  }

  /// For mechanical switches and toggles (snappy, rigid click)
  func rigidImpact() {
    let generator = UIImpactFeedbackGenerator(style: .rigid)
    generator.prepare()
    generator.impactOccurred()
  }

  /// For cryptographic compiling loops (rapid, soft taps)
  func softImpact() {
    let generator = UIImpactFeedbackGenerator(style: .soft)
    // prepare not needed for rapid repeating, but good practice
    generator.prepare()
    generator.impactOccurred()
  }

  /// For successful operations (e.g., ZKP verified)
  func successNotification() {
    let generator = UINotificationFeedbackGenerator()
    generator.prepare()
    generator.notificationOccurred(.success)
  }

  /// For errors (e.g., WinSystemError)
  func errorNotification() {
    let generator = UINotificationFeedbackGenerator()
    generator.prepare()
    generator.notificationOccurred(.error)
  }
}
