import SwiftUI

struct ShareFloatingActionButton: View {
  let action: () -> Void

  var body: some View {
    Button(action: {
      HapticFeedbackManager.shared.rigidImpact()
      action()
    }) {
      ZStack {
        Circle()
          .fill(Color.Theme.primaryBlue)
          .frame(width: 64, height: 64)
          .shadow(color: Color.Theme.primaryBlue.opacity(0.4), radius: 8, x: 0, y: 4)

        Image(systemName: "square.dashed.inset.filled")
          .font(.system(size: 28, weight: .bold))
          .foregroundColor(.white)
      }
    }
    .buttonStyle(ShareButtonStyle())
    .padding(.bottom, 24)
  }
}

private struct ShareButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.92 : 1.0)
      .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
  }
}
