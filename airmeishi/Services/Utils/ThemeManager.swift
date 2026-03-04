//
//  ThemeManager.swift
//  airmeishi
//
//  Centralized app theming: card accent color + optional glow
//

import SwiftUI

// MARK: - Color Scheme Setting

enum AppColorScheme: String, CaseIterable {
  case system
  case light
  case dark

  var displayName: String {
    switch self {
    case .system: return "System"
    case .light: return "Light"
    case .dark: return "Dark"
    }
  }

  var colorScheme: ColorScheme? {
    switch self {
    case .system: return nil
    case .light: return .light
    case .dark: return .dark
    }
  }
}

/// Global theme settings for card visuals and accents
final class ThemeManager: ObservableObject {
  static let shared = ThemeManager()

  @Published var appColorScheme: AppColorScheme {
    didSet { persist() }
  }

  @Published var cardAccent: Color {
    didSet { persist() }
  }

  @Published var enableGlow: Bool {
    didSet { persist() }
  }

  @Published var selectedAnimal: AnimalCharacter? {
    didSet { persist() }
  }

  /// Preset palette to pick from (from Pencil design system)
  let presets: [Color] = [
    Color(hex: 0xE091B3),  // rose pink (primary CTA)
    Color(hex: 0x0E73FF),  // blue (primary button)
    Color(hex: 0x4A66F0),  // indigo
    Color(hex: 0xA6678D),  // dusty mauve
    Color(hex: 0xD4BDE7),  // lavender
  ]

  private init() {
    let storedScheme = UserDefaults.standard.string(forKey: Self.Keys.appColorScheme)
    self.appColorScheme = AppColorScheme(rawValue: storedScheme ?? "") ?? .system

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
    UserDefaults.standard.set(appColorScheme.rawValue, forKey: Self.Keys.appColorScheme)
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
    static let appColorScheme = "theme_color_scheme"
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
    static var primaryAction: Color { Color.accentColor }
    static var secondaryAction: Color { Color(.systemGray) }
    static var buttonText: Color { Color.white }
    static var primaryText: Color { Color.primary }
    static var secondaryText: Color { Color.secondary }
    static var toolbarButton: Color { Color.accentColor }
    static var success: Color { Color.green }
    static var warning: Color { Color.orange }
    static var danger: Color { Color.red }
    static var lightning: Color { Color.yellow }
    static var cardBackground: Color { Color(.systemBackground) }
    static var secondaryBackground: Color { Color(.secondarySystemBackground) }
    static var groupedBackground: Color { Color(.systemGroupedBackground) }

    // Soft rose accent used for primary CTA buttons (#E091B3)
    static var accentRose: Color {
      Color(hex: 0xE091B3)
    }

    // MARK: - Design system colors (Dark Neo-Brutalist / Cyber Terminal)

    /// Pure black / Obsidian background
    static let pageBg = Color(hex: 0x050505)

    /// Dark UI elements
    static let darkUI = Color(white: 0.15)

    /// Pure white foreground for high contrast
    static let textPrimary = Color.white

    /// 70% foreground
    static let textSecondary = Color(white: 0.70)

    /// 50% foreground
    static let textTertiary = Color(white: 0.50)

    /// 30% foreground
    static let textPlaceholder = Color(white: 0.30)

    /// Extremely subtle background for inputs
    static let searchBg = Color(white: 1.0, opacity: 0.08)

    /// Sharp 1px borders
    static let divider = Color(white: 1.0, opacity: 0.15)

    /// Card background (slightly lighter than pageBg)
    static let cardBg = Color(hex: 0x111111)

    // MARK: - Primary / accent colors

    /// Cyber Blue (WinSystem borders, primary highlights)
    static let primaryBlue = Color(hex: 0x00A3FF)

    /// Terminal Green (Success, Hashes)
    static let terminalGreen = Color(hex: 0x00FF41)

    /// Dusty mauve for decorative elements (Keep for legacy compatibility, but darken)
    static let dustyMauve = Color(hex: 0x5C3A4D)

    /// Danger / Warning Red (Errors, Revoked badges)
    static let destructive = Color(hex: 0xFF3333)

    /// Warm cream for high-contrast inverted cards
    static let warmCream = Color(hex: 0xF9F9F6)

    /// Feature accent
    static let featureAccent = Color(hex: 0x00A3FF)

    // MARK: - Overlay / popup

    /// Popup overlay dimmer
    static let overlayBg = Color(white: 0, opacity: 0.65)

    /// Popup card surface
    static let popupSurface = Color(hex: 0x111111)

    // MARK: - Tab accent colors
    static let tabAccentMe = Color(white: 0.15)
    static let tabAccentSakura = Color(hex: 0x222233)
    static let tabAccentGroups = Color(hex: 0x1A2228)
    static let tabAccentSettings = Color(white: 0.18)

    // MARK: - Decorative blob / gradient colors (Converted to Dark theme equivalents)
    static let blobCenter = Color(hex: 0x151515)
    static let gradientPeach = Color(hex: 0x1A1512)
    static let gradientLavender = Color(hex: 0x18121A)
    static let gradientCream = Color(hex: 0x151210)

    // MARK: - Adaptive page gradient

    static func pageGradient(for scheme: ColorScheme) -> [Color] {
      return [pageBg, pageBg, pageBg]
    }

    // Translucent card surface
    static func cardSurface(for scheme: ColorScheme) -> Color {
      return Color.white.opacity(0.05)
    }

    // Subtle card border
    static func cardBorder(for scheme: ColorScheme) -> Color {
      return Color.white.opacity(0.1)
    }

    // Toolbar icon tint
    static func toolbarTint(for scheme: ColorScheme) -> Color {
      return Color.white.opacity(0.8)
    }

    /// 3-stop radial gradient for page backgrounds
    static func backgroundRadialGradient(for scheme: ColorScheme) -> RadialGradient {
      RadialGradient(
        colors: scheme == .dark
          ? [
              Color(red: 0.14, green: 0.12, blue: 0.16),
              Color(red: 0.11, green: 0.10, blue: 0.14),
              Color(red: 0.09, green: 0.08, blue: 0.10),
            ]
          : [gradientPeach, gradientLavender, gradientCream],
        center: .center,
        startRadius: 20,
        endRadius: 400
      )
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
