//
//  DecorativeBlobs.swift
//  airmeishi
//
//  Decorative nested ellipses (Ellipse 283/284/285 from design spec)
//  and radial gradient background.
//

import SwiftUI

// MARK: - 3-layer nested blob

/// Decorative radial-gradient circles that mirror the design-spec ellipses.
/// Place behind content using `.background(DecorativeBlobs())`.
struct DecorativeBlobs: View {
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    ZStack {
      blob(diameter: 286, opacity: 0.05)
      blob(diameter: 217, opacity: 0.20)
      blob(diameter: 136, opacity: 0.30)
    }
    .allowsHitTesting(false)
  }

  private func blob(diameter: CGFloat, opacity: Double) -> some View {
    Circle()
      .fill(
        RadialGradient(
          colors: [
            Color.Theme.blobCenter.opacity(opacity),
            Color.Theme.dustyMauve.opacity(opacity * 0.5),
          ],
          center: .center,
          startRadius: 0,
          endRadius: diameter / 2
        )
      )
      .overlay(
        Circle().stroke(Color.Theme.dustyMauve.opacity(opacity * 0.6), lineWidth: 1)
      )
      .frame(width: diameter, height: diameter)
  }
}

// MARK: - Full-screen radial gradient background

/// A peach → lavender → cream radial gradient that adapts to dark mode.
/// Use as `.background(DecorativeGradientBackground())`.
struct DecorativeGradientBackground: View {
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    Color.Theme.backgroundRadialGradient(for: colorScheme)
      .ignoresSafeArea()
  }
}
