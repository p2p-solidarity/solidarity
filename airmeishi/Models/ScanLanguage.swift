//
//  ScanLanguage.swift
//  airmeishi
//
//  Language selection for OCR scanning
//

import Foundation

/// Supported languages for OCR scanning
enum ScanLanguage: String, CaseIterable, Identifiable {
  case traditionalChinese = "zh-Hant"
  case japanese = "ja"
  case english = "en"

  var id: String { rawValue }

  var displayName: String {
    switch self {
    case .traditionalChinese:
      return String(localized: "Traditional Chinese")
    case .japanese:
      return String(localized: "Japanese")
    case .english:
      return String(localized: "English")
    }
  }

  var flag: String {
    switch self {
    case .traditionalChinese:
      return "🇹🇼"
    case .japanese:
      return "🇯🇵"
    case .english:
      return "🇺🇸"
    }
  }

  /// Get the language code for Vision framework
  var visionLanguageCode: String {
    return rawValue
  }

  /// Get all language codes for Vision framework
  static var allVisionLanguageCodes: [String] {
    return allCases.map { $0.visionLanguageCode }
  }
}
