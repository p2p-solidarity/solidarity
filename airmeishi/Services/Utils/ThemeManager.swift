//
//  ThemeManager.swift
//  airmeishi
//
//  Centralized app theming: card accent color + optional glow
//

import SwiftUI

/// Global theme settings for card visuals and accents
final class ThemeManager: ObservableObject {
  static let shared = ThemeManager()

  @Published var cardAccent: Color {
    didSet { persist() }
  }

  @Published var enableGlow: Bool {
    didSet { persist() }
  }

  @Published var selectedAnimal: AnimalCharacter? {
    didSet { persist() }
  }

  /// Preset palette to pick from
  let presets: [Color] = [
    Color(red: 0.20, green: 0.60, blue: 1.00),  // blue
    Color(red: 0.95, green: 0.40, blue: 0.50),  // pink
    Color(red: 0.35, green: 0.90, blue: 0.60),  // green
    Color(red: 0.85, green: 0.65, blue: 0.20),  // orange
    Color(red: 0.60, green: 0.50, blue: 1.00),  // purple
  ]

  private init() {
    let storedHex = UserDefaults.standard.string(forKey: Self.Keys.cardAccentHex)
    self.cardAccent = Color(hex: storedHex) ?? presets.first ?? .blue
    self.enableGlow = UserDefaults.standard.object(forKey: Self.Keys.enableGlow) as? Bool ?? true

    if let animalString = UserDefaults.standard.string(forKey: Self.Keys.selectedAnimal),
      let animal = AnimalCharacter(rawValue: animalString)
    {
      self.selectedAnimal = animal
    } else {
      self.selectedAnimal = nil
    }
  }

  private func persist() {
    UserDefaults.standard.set(cardAccent.toHexString(), forKey: Self.Keys.cardAccentHex)
    UserDefaults.standard.set(enableGlow, forKey: Self.Keys.enableGlow)
    if let animal = selectedAnimal {
      UserDefaults.standard.set(animal.rawValue, forKey: Self.Keys.selectedAnimal)
    } else {
      UserDefaults.standard.removeObject(forKey: Self.Keys.selectedAnimal)
    }
  }

  private enum Keys {
    static let cardAccentHex = "theme_card_accent_hex"
    static let enableGlow = "theme_enable_glow"
    static let selectedAnimal = "theme_selected_animal"
  }
}

// MARK: - Utilities

extension Color {
  init?(hex: String?) {
    guard let hex = hex else { return nil }
    var cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    if cleaned.count == 3 {  // RGB shorthand
      let r = cleaned[cleaned.startIndex]
      let g = cleaned[cleaned.index(cleaned.startIndex, offsetBy: 1)]
      let b = cleaned[cleaned.index(cleaned.startIndex, offsetBy: 2)]
      cleaned = "\(r)\(r)\(g)\(g)\(b)\(b)"
    }
    guard cleaned.count == 6, let intVal = Int(cleaned, radix: 16) else { return nil }
    let r = Double((intVal >> 16) & 0xFF) / 255.0
    let g = Double((intVal >> 8) & 0xFF) / 255.0
    let b = Double(intVal & 0xFF) / 255.0
    self = Color(red: r, green: g, blue: b)
  }

  func toHexString() -> String? {
    #if os(iOS)
      let ui = UIColor(self)
      var r: CGFloat = 0
      var g: CGFloat = 0
      var b: CGFloat = 0
      var a: CGFloat = 0
      guard ui.getRed(&r, green: &g, blue: &b, alpha: &a) else { return nil }
      let ri = Int(round(r * 255))
      let gi = Int(round(g * 255))
      let bi = Int(round(b * 255))
      return String(format: "%02X%02X%02X", ri, gi, bi)
    #else
      return nil
    #endif
  }

  /// Create a Color from 0xRRGGBB integer
  init(hex: Int) {
    let r = Double((hex >> 16) & 0xFF) / 255.0
    let g = Double((hex >> 8) & 0xFF) / 255.0
    let b = Double(hex & 0xFF) / 255.0
    self = Color(red: r, green: g, blue: b)
  }
}

// MARK: - Semantic Colors Extension

extension Color {
  /// Semantic colors that adapt to light/dark mode
  struct Theme {
    // Primary action color - adapts to theme
    static var primaryAction: Color {
      Color.accentColor
    }

    // Secondary action color
    static var secondaryAction: Color {
      Color(.systemGray)
    }

    // Button text on colored backgrounds
    static var buttonText: Color {
      Color.white
    }

    // Primary text that works in both modes
    static var primaryText: Color {
      Color.primary
    }

    // Secondary text
    static var secondaryText: Color {
      Color.secondary
    }

    // Toolbar and navigation button text
    static var toolbarButton: Color {
      Color.accentColor
    }

    // Success/positive color
    static var success: Color {
      Color.green
    }

    // Warning color
    static var warning: Color {
      Color.orange
    }

    // Danger/destructive color
    static var danger: Color {
      Color.red
    }

    // Lightning accent for special features
    static var lightning: Color {
      Color.yellow
    }

    // Card background
    static var cardBackground: Color {
      Color(.systemBackground)
    }

    // Secondary background
    static var secondaryBackground: Color {
      Color(.secondarySystemBackground)
    }

    // Grouped background
    static var groupedBackground: Color {
      Color(.systemGroupedBackground)
    }
  }
}

// MARK: - View helpers

extension View {
  /// Applies a soft glow using the provided color if enabled
  func cardGlow(_ color: Color, enabled: Bool) -> some View {
    self
      .shadow(color: enabled ? color.opacity(0.45) : .clear, radius: enabled ? 18 : 0, x: 0, y: 0)
      .shadow(color: enabled ? color.opacity(0.25) : .clear, radius: enabled ? 36 : 0, x: 0, y: 0)
  }
}
