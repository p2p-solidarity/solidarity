import SwiftUI

/// A component representing a single selectable field for ZK Selective Disclosure.
/// Uses Neo-Brutalist styling. When toggled off, the content is "redacted" with black bars.
struct RedactionSwitcherView: View {
  let label: String
  let value: String
  @Binding var isDisclosed: Bool

  var body: some View {
    HStack(spacing: 16) {
      // Toggle Switch (Rigid Haptics)
      Button(action: {
        HapticFeedbackManager.shared.rigidImpact()
        withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) {
          isDisclosed.toggle()
        }
      }) {
        ZStack {
          Rectangle()
            .fill(isDisclosed ? Color.Theme.terminalGreen : Color.Theme.searchBg)
            .frame(width: 44, height: 24)
            .overlay(
              Rectangle()
                .stroke(isDisclosed ? Color.Theme.terminalGreen : Color.Theme.divider, lineWidth: 1)
            )

          Rectangle()
            .fill(isDisclosed ? Color.black : Color.Theme.textSecondary)
            .frame(width: 18, height: 18)
            .offset(x: isDisclosed ? 9 : -9)
            .shadow(color: .black.opacity(0.3), radius: 2, x: 0, y: 1)
        }
      }
      .buttonStyle(.plain)

      VStack(alignment: .leading, spacing: 4) {
        Text(label.uppercased())
          .font(.system(size: 11, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)

        ZStack(alignment: .leading) {
          // Actual Value
          Text(value)
            .font(.system(size: 16, weight: .semibold, design: .default))
            .foregroundColor(Color.Theme.textPrimary)
            .opacity(isDisclosed ? 1 : 0)

          // Redacted State
          if !isDisclosed {
            Text("[██████ REDACTED]")
              .font(.system(size: 16, weight: .black, design: .monospaced))
              .foregroundColor(Color.Theme.destructive)
              .transition(.opacity)
          }
        }
      }

      Spacer()

      // Verified Badge (Only shows if disclosed)
      if isDisclosed {
        Image(systemName: "checkmark.seal.fill")
          .foregroundColor(Color.Theme.terminalGreen)
          .font(.system(size: 14))
          .transition(.scale.combined(with: .opacity))
      }
    }
    .padding(16)
    .background(isDisclosed ? Color.Theme.searchBg : .clear)
    .overlay(
      Rectangle()
        .stroke(Color.Theme.divider, lineWidth: 1)
    )
  }
}

// Preview
struct RedactionPreview: View {
  @State private var showName = true
  @State private var showDOB = false

  var body: some View {
    ZStack {
      Color.Theme.pageBg.ignoresSafeArea()
      VStack(spacing: 16) {
        RedactionSwitcherView(
          label: "Legal Name",
          value: "Satoshi Nakamoto",
          isDisclosed: $showName
        )

        RedactionSwitcherView(
          label: "Date of Birth",
          value: "1975-04-05",
          isDisclosed: $showDOB
        )
      }
      .padding()
    }
  }
}

#Preview {
  RedactionPreview()
}
