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

    // MARK: - Design system colors (Pencil, adaptive)

    /// Warm cream page background (light: #FBF9F2, dark: #1C1C1E)
    static let pageBg = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(red: 0.11, green: 0.11, blue: 0.12, alpha: 1)
        : UIColor(red: 0.984, green: 0.976, blue: 0.949, alpha: 1)
    })
    /// Dark UI elements — inverts in dark mode
    static let darkUI = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(white: 0.9, alpha: 1)
        : UIColor(red: 0.184, green: 0.184, blue: 0.188, alpha: 1)
    })
    /// 90% foreground for titles/names
    static let textPrimary = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(white: 1, alpha: 0.9)
        : UIColor(white: 0, alpha: 0.9)
    })
    /// 70% foreground for subtitles/occupation
    static let textSecondary = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(white: 1, alpha: 0.7)
        : UIColor(white: 0, alpha: 0.7)
    })
    /// 50% foreground for notes/dates
    static let textTertiary = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(white: 1, alpha: 0.5)
        : UIColor(white: 0, alpha: 0.5)
    })
    /// 30% foreground for search placeholder
    static let textPlaceholder = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(white: 1, alpha: 0.3)
        : UIColor(white: 0, alpha: 0.3)
    })
    /// Search field / tags background
    static let searchBg = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(white: 1, alpha: 0.08)
        : UIColor(white: 0, alpha: 0.05)
    })
    /// Separators / borders
    static let divider = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(white: 1, alpha: 0.16)
        : UIColor(white: 0, alpha: 0.16)
    })
    /// Card / elevated surface background
    static let cardBg = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(red: 0.17, green: 0.17, blue: 0.18, alpha: 1)
        : UIColor(white: 1, alpha: 1)
    })

    // MARK: - Primary / accent colors

    /// Primary blue for buttons (#0E73FF)
    static let primaryBlue = Color(hex: 0x0E73FF)

    /// Dusty mauve for decorative elements (#A6678D, slightly lighter in dark)
    static let dustyMauve = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(red: 0.72, green: 0.47, blue: 0.62, alpha: 1)   // lighter
        : UIColor(red: 0.651, green: 0.404, blue: 0.553, alpha: 1) // #A6678D
    })

    /// Destructive / error red (#D04343, slightly brighter in dark)
    static let destructive = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(red: 0.87, green: 0.32, blue: 0.32, alpha: 1)
        : UIColor(red: 0.816, green: 0.263, blue: 0.263, alpha: 1) // #D04343
    })

    /// Warm cream for secondary button backgrounds
    static let warmCream = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(red: 0.20, green: 0.18, blue: 0.16, alpha: 1)
        : UIColor(red: 0.984, green: 0.965, blue: 0.929, alpha: 1) // #FBF6ED
    })

    /// Feature accent (replaces hardcoded .yellow for Lightning features)
    static let featureAccent = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(red: 1.0, green: 0.84, blue: 0.25, alpha: 1)    // gold
        : UIColor(red: 0.85, green: 0.60, blue: 0.10, alpha: 1)   // warm amber
    })

    // MARK: - Overlay / popup

    /// Popup overlay dimmer
    static let overlayBg = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(white: 0, alpha: 0.50)
        : UIColor(white: 0, alpha: 0.35)
    })

    /// Popup card surface
    static let popupSurface = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(red: 0.17, green: 0.17, blue: 0.18, alpha: 1)
        : UIColor(white: 0.97, alpha: 1)
    })

    // MARK: - Tab accent colors

    static let tabAccentMe = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(red: 0.40, green: 0.28, blue: 0.34, alpha: 1)
        : UIColor(red: 0.996, green: 0.945, blue: 0.961, alpha: 1) // #FEF1F5
    })

    static let tabAccentSakura = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(red: 0.30, green: 0.32, blue: 0.45, alpha: 1)
        : UIColor(red: 0.835, green: 0.863, blue: 1.0, alpha: 1)  // #D5DCFF
    })

    static let tabAccentGroups = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(red: 0.26, green: 0.32, blue: 0.38, alpha: 1)
        : UIColor(red: 0.824, green: 0.882, blue: 0.945, alpha: 1) // #D2E1F1
    })

    static let tabAccentSettings = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(red: 0.28, green: 0.30, blue: 0.33, alpha: 1)
        : UIColor(red: 0.867, green: 0.898, blue: 0.925, alpha: 1) // #DDE5EC
    })

    // MARK: - Decorative blob / gradient colors

    /// Blob center color (#FCF8F0)
    static let blobCenter = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(red: 0.20, green: 0.18, blue: 0.16, alpha: 1)
        : UIColor(red: 0.988, green: 0.973, blue: 0.941, alpha: 1) // #FCF8F0
    })

    /// Gradient peach (#FFEADB)
    static let gradientPeach = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(red: 0.30, green: 0.22, blue: 0.16, alpha: 1)
        : UIColor(red: 1.0, green: 0.918, blue: 0.859, alpha: 1)  // #FFEADB
    })

    /// Gradient lavender (#D4BDE7)
    static let gradientLavender = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(red: 0.28, green: 0.22, blue: 0.35, alpha: 1)
        : UIColor(red: 0.831, green: 0.741, blue: 0.906, alpha: 1) // #D4BDE7
    })

    /// Gradient cream (#FFF8E6)
    static let gradientCream = Color(UIColor { tc in
      tc.userInterfaceStyle == .dark
        ? UIColor(red: 0.22, green: 0.20, blue: 0.14, alpha: 1)
        : UIColor(red: 1.0, green: 0.973, blue: 0.902, alpha: 1)  // #FFF8E6
    })

    // MARK: - Adaptive page gradient

    static func pageGradient(for scheme: ColorScheme) -> [Color] {
      switch scheme {
      case .dark:
        return [
          Color(red: 0.07, green: 0.05, blue: 0.10),
          Color(red: 0.09, green: 0.07, blue: 0.12),
          Color(red: 0.08, green: 0.06, blue: 0.10),
        ]
      case .light:
        return [pageBg, pageBg, pageBg]
      @unknown default:
        return pageGradient(for: .light)
      }
    }

    // Translucent card surface
    static func cardSurface(for scheme: ColorScheme) -> Color {
      scheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.7)
    }

    // Subtle card border
    static func cardBorder(for scheme: ColorScheme) -> Color {
      scheme == .dark ? Color.white.opacity(0.08) : Color.primary.opacity(0.06)
    }

    // Toolbar icon tint
    static func toolbarTint(for scheme: ColorScheme) -> Color {
      scheme == .dark ? Color.white.opacity(0.8) : Color.primary.opacity(0.7)
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
