import SwiftUI

struct ToastView: View {
  let toast: Toast
  let onDismiss: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .top, spacing: 12) {
        Image(systemName: toast.type.icon)
          .foregroundColor(toast.type.color)
          .font(.system(size: 20))

        VStack(alignment: .leading, spacing: 4) {
          Text(toast.title)
            .font(.headline)
            .foregroundColor(.primary)

          if let message = toast.message {
            Text(message)
              .font(.subheadline)
              .foregroundColor(.secondary)
          }
        }

        Spacer()

        Button(action: onDismiss) {
          Image(systemName: "xmark")
            .foregroundColor(.secondary)
            .font(.system(size: 14))
        }
      }

      if let action = toast.action, let label = toast.actionLabel {
        Button(action: {
          action()
          onDismiss()
        }) {
          Text(label)
            .font(.subheadline)
            .fontWeight(.semibold)
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(toast.type.color)
            .cornerRadius(8)
        }
      }
    }
    .padding(16)
    .background(
      RoundedRectangle(cornerRadius: 16)
        .fill(Color(UIColor.systemBackground))
        .shadow(color: Color.black.opacity(0.15), radius: 10, x: 0, y: 5)
    )
    .padding(.horizontal, 16)
    .padding(.top, 8)  // Safe area padding usually handled by parent
  }
}

struct ToastOverlay: ViewModifier {
  @ObservedObject var manager = ToastManager.shared

  func body(content: Content) -> some View {
    ZStack(alignment: .top) {
      content

      if let toast = manager.currentToast {
        ToastView(toast: toast) {
          manager.dismiss()
        }
        .transition(.move(edge: .top).combined(with: .opacity))
        .zIndex(100)
        .padding(.top, 44)  // Approximate status bar height or dynamic
      }
    }
  }
}

extension View {
  func toastOverlay() -> some View {
    self.modifier(ToastOverlay())
  }
}
