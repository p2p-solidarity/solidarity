//
//  ThemedButtonStyles.swift
//  airmeishi
//
//  Reusable button styles aligned to the design system.
//

import SwiftUI

// MARK: - Primary (blue, white text)

struct ThemedPrimaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .fontWeight(.semibold)
      .foregroundColor(.white)
      .padding(.horizontal, 24)
      .padding(.vertical, 14)
      .frame(maxWidth: .infinity)
      .background(Color.Theme.primaryBlue)
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
  }
}

// MARK: - Secondary (translucent + border)

struct ThemedSecondaryButtonStyle: ButtonStyle {
  @Environment(\.colorScheme) private var colorScheme

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .fontWeight(.medium)
      .foregroundColor(Color.Theme.textPrimary)
      .padding(.horizontal, 24)
      .padding(.vertical, 14)
      .frame(maxWidth: .infinity)
      .background(Color.Theme.cardSurface(for: colorScheme))
      .overlay(
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .stroke(Color.Theme.cardBorder(for: colorScheme), lineWidth: 1)
      )
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
  }
}

// MARK: - Rose CTA (pink accent)

struct ThemedRoseButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .fontWeight(.semibold)
      .foregroundColor(.white)
      .padding(.horizontal, 24)
      .padding(.vertical, 14)
      .frame(maxWidth: .infinity)
      .background(
        LinearGradient(
          colors: [Color.Theme.accentRose, Color.Theme.dustyMauve],
          startPoint: .leading,
          endPoint: .trailing
        )
      )
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      .shadow(color: Color.Theme.accentRose.opacity(0.3), radius: 8, x: 0, y: 4)
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
  }
}

// MARK: - Outline (white/pageBg bg, blue text + border)

struct ThemedOutlineButtonStyle: ButtonStyle {
  @Environment(\.colorScheme) private var colorScheme

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .fontWeight(.medium)
      .foregroundColor(Color.Theme.primaryBlue)
      .padding(.horizontal, 24)
      .padding(.vertical, 14)
      .frame(maxWidth: .infinity)
      .background(Color.Theme.cardBg)
      .overlay(
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .stroke(Color.Theme.primaryBlue.opacity(0.4), lineWidth: 1)
      )
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
  }
}

// MARK: - Destructive (red)

struct ThemedDestructiveButtonStyle: ButtonStyle {
  @Environment(\.colorScheme) private var colorScheme

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .fontWeight(.medium)
      .foregroundColor(Color.Theme.destructive)
      .padding(.horizontal, 24)
      .padding(.vertical, 14)
      .frame(maxWidth: .infinity)
      .background(Color.Theme.destructive.opacity(colorScheme == .dark ? 0.15 : 0.08))
      .overlay(
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .stroke(Color.Theme.destructive.opacity(0.3), lineWidth: 1)
      )
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
  }
}
