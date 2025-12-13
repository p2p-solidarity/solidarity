//
//  AnimalCharacter.swift
//  airmeishi
//
//  Defines selectable animal characters for card styling and UX.
//

import Foundation

/// Five selectable animal characters to theme a business card
enum AnimalCharacter: String, Codable, CaseIterable, Identifiable, Equatable {
  case dog
  case horse
  case pig
  case sheep
  case dove

  var id: String { rawValue }

  /// Display name for UI
  var displayName: String {
    switch self {
    case .dog: return "Dog"
    case .horse: return "Horse"
    case .pig: return "Pig"
    case .sheep: return "Sheep"
    case .dove: return "Dove"
    }
  }

  /// Short personality blurb for UX
  var personality: String {
    switch self {
    case .dog: return "Loyal connector — warm intros, steady follow‑through."
    case .horse: return "Driven achiever — fast pace, big energy, bold goals."
    case .pig: return "Practical strategist — grounded, systematic, gets results."
    case .sheep: return "Calm collaborator — inclusive, thoughtful, team‑first."
    case .dove: return "Diplomatic storyteller — clear voice, builds trust quickly."
    }
  }

  /// Basename of the preferred PNG in Resources (no extension)
  var imageBasename: String {
    switch self {
    case .dog: return "dog"
    case .horse: return "horse"
    case .pig: return "pig"
    case .sheep: return "sheep"
    case .dove: return "dove"
    }
  }
}
