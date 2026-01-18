//
//  AdaptiveLayout.swift
//  airmeishi
//
//  Provides adaptive layout modifiers for iPad/landscape support.
//  iPhone layout remains unchanged. iPad gets full-screen native experience.
//

import SwiftUI

// MARK: - Environment Key for iPad Detection

private struct IsRegularWidthKey: EnvironmentKey {
  static let defaultValue: Bool = false
}

extension EnvironmentValues {
  var isRegularWidth: Bool {
    get { self[IsRegularWidthKey.self] }
    set { self[IsRegularWidthKey.self] = newValue }
  }
}

// MARK: - Adaptive Layout Modifiers

extension View {
  /// Replaces `.padding(.horizontal, X)` and `.padding(.vertical, Y)`
  /// Automatically adjusts for iPad/landscape while preserving iPhone layout.
  ///
  /// - Parameters:
  ///   - horizontal: Horizontal padding (default: 16). iPad uses 1.5x.
  ///   - vertical: Vertical padding (default: 20). Unchanged on iPad.
  /// - Returns: Modified view with adaptive padding.
  func adaptivePadding(
    horizontal: CGFloat = 16,
    vertical: CGFloat = 20
  ) -> some View {
    modifier(AdaptivePaddingModifier(horizontal: horizontal, vertical: vertical))
  }

  /// Limits maximum width on iPad/landscape to prevent content stretching.
  /// Content is centered when width is constrained.
  ///
  /// - Parameter maxWidth: Maximum width on iPad (default: 700pt).
  /// - Returns: Modified view with adaptive max width.
  func adaptiveMaxWidth(_ maxWidth: CGFloat = 700) -> some View {
    modifier(AdaptiveMaxWidthModifier(maxWidth: maxWidth))
  }

  /// Wraps content in an adaptive container that centers on iPad.
  /// Use this on the main content area of a view for full-screen iPad feel.
  ///
  /// - Parameter maxWidth: Maximum content width on iPad (default: 800pt).
  /// - Returns: Modified view with adaptive container.
  func adaptiveContainer(maxWidth: CGFloat = 800) -> some View {
    modifier(AdaptiveContainerModifier(maxWidth: maxWidth))
  }

  /// Creates adaptive grid columns based on device size.
  /// iPhone: 2 columns, iPad: 3-4 columns based on width.
  ///
  /// - Parameters:
  ///   - minColumnWidth: Minimum width for each column (default: 160).
  ///   - spacing: Spacing between columns (default: 16).
  /// - Returns: Array of GridItem for LazyVGrid.
  static func adaptiveGridColumns(
    minColumnWidth: CGFloat = 160,
    spacing: CGFloat = 16
  ) -> [GridItem] {
    // This is a static helper, actual logic in AdaptiveGridModifier
    [GridItem(.adaptive(minimum: minColumnWidth), spacing: spacing)]
  }
}

// MARK: - Adaptive Grid Column Count Helper

struct AdaptiveGridHelper {
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass

  /// Returns column count based on device.
  /// iPhone: 2, iPad Portrait: 3, iPad Landscape: 4
  static func columnCount(for sizeClass: UserInterfaceSizeClass?) -> Int {
    sizeClass == .regular ? 3 : 2
  }

  /// Creates grid columns for the given size class.
  static func columns(
    for sizeClass: UserInterfaceSizeClass?,
    spacing: CGFloat = 16
  ) -> [GridItem] {
    let count = columnCount(for: sizeClass)
    return Array(repeating: GridItem(.flexible(), spacing: spacing), count: count)
  }
}

// MARK: - Modifiers

private struct AdaptivePaddingModifier: ViewModifier {
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass

  let horizontal: CGFloat
  let vertical: CGFloat

  private var isRegularWidth: Bool {
    horizontalSizeClass == .regular
  }

  func body(content: Content) -> some View {
    content
      .padding(.horizontal, isRegularWidth ? horizontal * 1.5 : horizontal)
      .padding(.vertical, vertical)
  }
}

private struct AdaptiveMaxWidthModifier: ViewModifier {
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass

  let maxWidth: CGFloat

  private var isRegularWidth: Bool {
    horizontalSizeClass == .regular
  }

  func body(content: Content) -> some View {
    if isRegularWidth {
      content
        .frame(maxWidth: maxWidth)
        .frame(maxWidth: .infinity)
    } else {
      content
    }
  }
}

private struct AdaptiveContainerModifier: ViewModifier {
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass

  let maxWidth: CGFloat

  private var isRegularWidth: Bool {
    horizontalSizeClass == .regular
  }

  func body(content: Content) -> some View {
    GeometryReader { geometry in
      if isRegularWidth {
        content
          .frame(maxWidth: min(maxWidth, geometry.size.width * 0.85))
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        content
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
  }
}

// MARK: - Adaptive Grid View

/// A grid view that automatically adapts column count for iPad.
struct AdaptiveGrid<Content: View>: View {
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass

  let spacing: CGFloat
  let content: () -> Content

  init(spacing: CGFloat = 16, @ViewBuilder content: @escaping () -> Content) {
    self.spacing = spacing
    self.content = content
  }

  private var columns: [GridItem] {
    AdaptiveGridHelper.columns(for: horizontalSizeClass, spacing: spacing)
  }

  var body: some View {
    LazyVGrid(columns: columns, spacing: spacing, content: content)
  }
}
