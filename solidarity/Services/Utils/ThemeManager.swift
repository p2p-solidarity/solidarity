//
//  ThemeManager.swift
//  solidarity
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

// MARK: - Figma Palette

extension Color {
  /// Raw palette mirroring the Figma design-system variables
  /// (file: Solid(ar)ity, node 621-2155).
  ///
  /// Prefer semantic `Color.Theme.*` tokens in view code. Reach for
  /// `Color.Palette.*` when you genuinely need a specific brand swatch
  /// (e.g. illustrations, charts, print assets) independent of theme.
  struct Palette {
    // Neutrals — darkest (#1) to lightest (#7)
    static let ink = Color(hex: 0x2F2F30)  // #1 — primary text on light
    static let slate = Color(hex: 0x5F5E67)  // #2 — secondary text
    static let stone = Color(hex: 0x9C9AA6)  // #3 — tertiary text / placeholder
    static let fog = Color(hex: 0xD1D1D1)  // #4 — divider / border
    static let mist = Color(hex: 0xEEEEEE)  // #5 — search / input surface
    static let cream = Color(hex: 0xFBF9F2)  // #6 — page background
    static let paper = Color(hex: 0xFFFFFF)  // #7 — card surface

    // Accents
    static let purple = Color(hex: 0x83537D)  // brand mauve
    static let green = Color(hex: 0x4CAF51)  // success
    static let red = Color(hex: 0xCD556A)  // destructive

    /// All palette colors in display order (for swatch previews / pickers).
    static let all: [(name: String, color: Color)] = [
      ("ink", ink), ("slate", slate), ("stone", stone), ("fog", fog),
      ("mist", mist), ("cream", cream), ("paper", paper),
      ("purple", purple), ("green", green), ("red", red),
    ]
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

    // Soft rose accent used for primary CTA buttons
    static var accentRose: Color { Color(hex: 0xBF80A7) }

    // MARK: - Swiss Sunrise Palette (Light) + Deep Alpine Night (Dark)

    /// Page background: warm cream (light) / deep brown-purple (dark)
    /// Light: `Palette.cream` (#fbf9f2)
    static let pageBg = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.10, green: 0.07, blue: 0.09, alpha: 1)  // #1A1218
        : UIColor(red: 0.984, green: 0.976, blue: 0.949, alpha: 1)  // #fbf9f2
    }))

    /// Dark UI elements
    static let darkUI = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(white: 0.15, alpha: 1)
        : UIColor(red: 0.82, green: 0.78, blue: 0.82, alpha: 1)  // #D1C7D1
    }))

    /// Primary text: dark charcoal (light) / off-white lavender (dark)
    static let textPrimary = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.94, green: 0.91, blue: 0.94, alpha: 1)  // #F0E8F0
        : UIColor(red: 0.184, green: 0.184, blue: 0.188, alpha: 1)  // #2f2f30
    }))

    /// Secondary text
    static let textSecondary = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.66, green: 0.60, blue: 0.66, alpha: 1)  // #A898A8
        : UIColor(red: 0.373, green: 0.369, blue: 0.404, alpha: 1)  // #5f5e67
    }))

    /// Tertiary text
    static let textTertiary = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(white: 0.50, alpha: 1)
        : UIColor(red: 0.612, green: 0.604, blue: 0.651, alpha: 1)  // #9c9aa6
    }))

    /// Placeholder text
    static let textPlaceholder = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(white: 0.30, alpha: 1)
        : UIColor(red: 0.612, green: 0.604, blue: 0.651, alpha: 1)  // #9c9aa6
    }))

    /// Search/input background
    static let searchBg = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(white: 1.0, alpha: 0.08)
        : UIColor(red: 0.933, green: 0.933, blue: 0.933, alpha: 1)  // #eeeeee
    }))

    /// Divider / border
    static let divider = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(white: 1.0, alpha: 0.15)
        : UIColor(red: 0.820, green: 0.820, blue: 0.820, alpha: 1)  // #d1d1d1
    }))

    /// Card background
    static let cardBg = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.07, green: 0.04, blue: 0.07, alpha: 1)  // #111111
        : UIColor(white: 1.0, alpha: 1)  // #ffffff
    }))

    // MARK: - Primary / accent colors

    /// Brand mauve (replaces cyber blue as primary accent)
    static let primaryBlue = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.75, green: 0.53, blue: 0.63, alpha: 1)  // #C088A0
        : UIColor(red: 0.514, green: 0.325, blue: 0.490, alpha: 1)  // #83537d
    }))

    /// Success green
    static let terminalGreen = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.0, green: 1.0, blue: 0.25, alpha: 1)
        : UIColor(red: 0.298, green: 0.686, blue: 0.318, alpha: 1)  // #4caf51
    }))

    /// Dusty mauve decorative
    static let dustyMauve = Color(hex: 0xA6678D)

    /// Danger red
    static let destructive = Color(hex: 0xCD556A)

    /// Warm cream for inverted cards
    static let warmCream = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.97, green: 0.97, blue: 0.96, alpha: 1)
        : UIColor(red: 0.953, green: 0.922, blue: 0.867, alpha: 1)  // #f3ebdd
    }))

    /// Feature accent (brand mauve)
    static let featureAccent = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.75, green: 0.53, blue: 0.63, alpha: 1)  // #C088A0
        : UIColor(red: 0.514, green: 0.325, blue: 0.490, alpha: 1)  // #83537d
    }))

    // MARK: - Radar / sharing specific
    /// Soft glow center for radar
    static let radarGlow = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.75, green: 0.53, blue: 0.63, alpha: 0.3)
        : UIColor(red: 0.80, green: 0.65, blue: 0.78, alpha: 0.4)
    }))

    /// Radar ring color
    static let radarRing = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.75, green: 0.53, blue: 0.63, alpha: 0.25)
        : UIColor(red: 0.70, green: 0.55, blue: 0.70, alpha: 0.25)
    }))

    // MARK: - Overlay / popup

    static let overlayBg = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(white: 0, alpha: 0.65)
        : UIColor(red: 0.16, green: 0.10, blue: 0.18, alpha: 0.45)
    }))

    static let popupSurface = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.07, green: 0.04, blue: 0.07, alpha: 1)
        : UIColor(white: 1.0, alpha: 1)
    }))

    // MARK: - Tab accent colors
    static let tabAccentMe = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(white: 0.15, alpha: 1)
        : UIColor(red: 0.984, green: 0.976, blue: 0.949, alpha: 1)  // #fbf9f2
    }))
    static let tabAccentSakura = Color(hex: 0x222233)
    static let tabAccentGroups = Color(hex: 0x1A2228)
    static let tabAccentSettings = Color(white: 0.18)

    // MARK: - Decorative gradient colors
    static let blobCenter = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.08, green: 0.06, blue: 0.08, alpha: 1)
        : UIColor(red: 0.941, green: 0.929, blue: 0.957, alpha: 1)  // #f0edf4
    }))
    static let gradientPeach = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.10, green: 0.08, blue: 0.07, alpha: 1)
        : UIColor(red: 0.953, green: 0.875, blue: 0.867, alpha: 1)  // #f3dfdd
    }))
    static let gradientLavender = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.09, green: 0.07, blue: 0.10, alpha: 1)
        : UIColor(red: 0.914, green: 0.890, blue: 0.929, alpha: 1)  // #e9e3ed
    }))
    static let gradientCream = Color(.init(dynamicProvider: { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.08, green: 0.07, blue: 0.06, alpha: 1)
        : UIColor(red: 0.941, green: 0.929, blue: 0.957, alpha: 1)  // #f0edf4
    }))

    // MARK: - Adaptive functions

    static func pageGradient(for scheme: ColorScheme) -> [Color] {
      if scheme == .dark {
        return [
          Color(hex: 0x1A1218),
          Color(hex: 0x16101A),
          Color(hex: 0x120E16),
        ]
      } else {
        return [
          Color(hex: 0xE6DBE6),
          Color(hex: 0xDED0DE),
          Color(hex: 0xD8C8D8),
        ]
      }
    }

    static func cardSurface(for scheme: ColorScheme) -> Color {
      scheme == .dark
        ? Color.white.opacity(0.05)
        : Color.white.opacity(0.85)
    }

    static func cardBorder(for scheme: ColorScheme) -> Color {
      scheme == .dark
        ? Color.white.opacity(0.1)
        : Color(hex: 0xC8B8C8).opacity(0.6)
    }

    static func toolbarTint(for scheme: ColorScheme) -> Color {
      scheme == .dark
        ? Color.white.opacity(0.8)
        : Color(hex: 0x2A1A2E).opacity(0.8)
    }

    static func backgroundRadialGradient(for scheme: ColorScheme) -> RadialGradient {
      RadialGradient(
        colors: scheme == .dark
          ? [
              Color(red: 0.14, green: 0.10, blue: 0.14),
              Color(red: 0.11, green: 0.08, blue: 0.12),
              Color(red: 0.08, green: 0.06, blue: 0.09),
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
