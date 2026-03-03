import SwiftUI

/// A floating action button designed to sit above the tab bar or in the center.
/// Features high-contrast Neo-Brutalist styling to draw attention.
struct ScanFloatingActionButton: View {
  let action: () -> Void
  @State private var isPressed = false
  
  var body: some View {
    Button(action: {
      HapticFeedbackManager.shared.heavyImpact()
      action()
    }) {
      HStack(spacing: 8) {
        Image(systemName: "viewfinder")
          .font(.system(size: 20, weight: .bold))
        Text("SCAN")
          .font(.system(size: 16, weight: .bold, design: .monospaced))
      }
      .foregroundColor(.black)
      .padding(.horizontal, 24)
      .padding(.vertical, 16)
      // High contrast solid background
      .background(Color.Theme.terminalGreen)
      // Sharp, brutalist edges
      .clipShape(Rectangle())
      // Solid cyber offset shadow
      .shadow(color: Color.Theme.primaryBlue, radius: 0, x: 4, y: 4)
      .overlay(
        Rectangle()
          .stroke(Color.black, lineWidth: 2)
      )
    }
    .buttonStyle(FABButtonStyle())
    .padding(.bottom, 24)
  }
}

private struct FABButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.95 : 1)
      .offset(
        x: configuration.isPressed ? 4 : 0,
        y: configuration.isPressed ? 4 : 0
      )
      .shadow(color: Color.Theme.primaryBlue, radius: 0, x: configuration.isPressed ? 0 : 4, y: configuration.isPressed ? 0 : 4)
      .animation(.spring(response: 0.2, dampingFraction: 0.8), value: configuration.isPressed)
  }
}

// Preview
#Preview {
  ZStack {
    Color.Theme.pageBg.ignoresSafeArea()
    ScanFloatingActionButton(action: {})
  }
}
