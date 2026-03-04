//
//  ThemedButtonStyles.swift
//  airmeishi
//

import SwiftUI

// MARK: - Primary (Neo-Brutalist Dark)

struct ThemedPrimaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 16, weight: .medium, design: .default))
      .foregroundColor(.white)
      .padding(.horizontal, 24)
      .padding(.vertical, 14)
      .frame(maxWidth: .infinity)
      // Solid dark gray/black background
      .background(Color(white: 0.15))
      // 1px border like the screenshots
      .overlay(
        Rectangle()
          .stroke(Color.white.opacity(0.2), lineWidth: 1)
      )
      // Sharp corners
      .clipShape(Rectangle())
      .scaleEffect(configuration.isPressed ? 0.98 : 1)
      .animation(.spring(response: 0.15, dampingFraction: 1), value: configuration.isPressed)
      .onChange(of: configuration.isPressed) { _, isPressed in
        if isPressed { HapticFeedbackManager.shared.heavyImpact() }
      }
  }
}

// MARK: - Inverted Button (White bg, black text)

struct ThemedInvertedButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 16, weight: .medium, design: .default))
      .foregroundColor(.black)
      .padding(.horizontal, 24)
      .padding(.vertical, 14)
      .frame(maxWidth: .infinity)
      .background(Color.white)
      .clipShape(Rectangle())
      .scaleEffect(configuration.isPressed ? 0.98 : 1)
      .animation(.spring(response: 0.15, dampingFraction: 1), value: configuration.isPressed)
      .onChange(of: configuration.isPressed) { _, isPressed in
        if isPressed { HapticFeedbackManager.shared.heavyImpact() }
      }
  }
}

// MARK: - Secondary (Translucent + Border)

struct ThemedSecondaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 16, weight: .regular, design: .default))
      .foregroundColor(Color.Theme.textPrimary)
      .padding(.horizontal, 24)
      .padding(.vertical, 14)
      .frame(maxWidth: .infinity)
      .background(Color.Theme.cardBg)
      .overlay(
        Rectangle()
          .stroke(Color.Theme.divider, lineWidth: 1)
      )
      .clipShape(Rectangle())
      .scaleEffect(configuration.isPressed ? 0.98 : 1)
      .animation(.spring(response: 0.15, dampingFraction: 1), value: configuration.isPressed)
      .onChange(of: configuration.isPressed) { _, isPressed in
        if isPressed { HapticFeedbackManager.shared.rigidImpact() }
      }
  }
}

// MARK: - Dotted Outline (Cyber Blue)

struct ThemedDottedOutlineButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 16, weight: .regular, design: .default))
      .foregroundColor(Color.Theme.primaryBlue)
      .padding(.horizontal, 24)
      .padding(.vertical, 14)
      .frame(maxWidth: .infinity)
      .background(Color.clear)
      .overlay(
        Rectangle()
          .stroke(style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
          .foregroundColor(Color.Theme.primaryBlue)
      )
      .clipShape(Rectangle())
      .scaleEffect(configuration.isPressed ? 0.98 : 1)
      .animation(.spring(response: 0.15, dampingFraction: 1), value: configuration.isPressed)
  }
}

// MARK: - Destructive (Red)

struct ThemedDestructiveButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 16, weight: .medium, design: .default))
      .foregroundColor(Color.Theme.destructive)
      .padding(.horizontal, 24)
      .padding(.vertical, 14)
      .frame(maxWidth: .infinity)
      .background(Color.clear)
      .overlay(
        Rectangle()
          .stroke(Color.Theme.destructive, lineWidth: 1)
      )
      .clipShape(Rectangle())
      .scaleEffect(configuration.isPressed ? 0.98 : 1)
      .animation(.spring(response: 0.15, dampingFraction: 1), value: configuration.isPressed)
      .onChange(of: configuration.isPressed) { _, isPressed in
        if isPressed { HapticFeedbackManager.shared.rigidImpact() }
      }
  }
}
