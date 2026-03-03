import SwiftUI

/// A custom error dialog component modeled after the "Something went wrong" Neo-Brutalist / Cyber Terminal screenshot.
/// Features a solid blue 1px outer border, a dashed inner border for the content, and sharp edges.
struct WinSystemErrorDialog: View {
  let title: String
  let message: String
  let primaryActionTitle: String
  let primaryAction: () -> Void
  let secondaryActionTitle: String?
  let secondaryAction: (() -> Void)?
  let dismissAction: () -> Void
  
  var body: some View {
    VStack(spacing: 24) {
      // Top Area: Content with Dashed Border
      VStack(alignment: .leading, spacing: 12) {
        HStack(alignment: .top) {
          Text(title)
            .font(.system(size: 18, weight: .bold, design: .default))
            .foregroundColor(.white)
          
          Spacer()
          
          Button(action: {
            HapticFeedbackManager.shared.rigidImpact()
            dismissAction()
          }) {
            Image(systemName: "xmark")
              .font(.system(size: 14, weight: .semibold))
              .foregroundColor(.white)
              .padding(4)
              // Dotted outline for the close button
              .overlay(
                Rectangle()
                  .stroke(style: StrokeStyle(lineWidth: 1, dash: [2, 2]))
                  .foregroundColor(Color.Theme.primaryBlue)
              )
          }
        }
        
        Text(message)
          .font(.system(size: 16, weight: .regular))
          .foregroundColor(Color.Theme.textSecondary)
          .lineSpacing(4)
      }
      .padding(16)
      // Dotted outline for the message block
      .overlay(
        Rectangle()
          .stroke(style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
          .foregroundColor(Color.Theme.primaryBlue)
      )
      
      // Bottom Area: Buttons
      VStack(spacing: 12) {
        Button(action: {
          primaryAction()
        }) {
          Text(primaryActionTitle)
        }
        .buttonStyle(ThemedInvertedButtonStyle()) // White bg, black text
        
        if let secondaryTitle = secondaryActionTitle, let secondaryAct = secondaryAction {
          Button(action: {
            secondaryAct()
          }) {
            Text(secondaryTitle)
          }
          .buttonStyle(ThemedPrimaryButtonStyle()) // Dark bg, white text, dim border
        }
      }
    }
    .padding(20)
    .background(Color.Theme.cardBg)
    // 1px Solid Blue outer border
    .overlay(
      Rectangle()
        .stroke(Color.Theme.primaryBlue, lineWidth: 2)
    )
    .clipShape(Rectangle())
    .padding(24) // Outer padding for the screen
    .onAppear {
      HapticFeedbackManager.shared.errorNotification()
    }
  }
}

// MARK: - View Modifier for Easy Presentation

struct WinSystemErrorModifier: ViewModifier {
  @Binding var isPresented: Bool
  let title: String
  let message: String
  let primaryActionTitle: String
  let primaryAction: () -> Void
  var secondaryActionTitle: String? = nil
  var secondaryAction: (() -> Void)? = nil
  
  func body(content: Content) -> some View {
    ZStack {
      content
      
      if isPresented {
        Color.black.opacity(0.8)
          .ignoresSafeArea()
          .onTapGesture {
            // Optional: Dismiss on background tap
          }
          .transition(.opacity)
        
        WinSystemErrorDialog(
          title: title,
          message: message,
          primaryActionTitle: primaryActionTitle,
          primaryAction: {
            isPresented = false
            primaryAction()
          },
          secondaryActionTitle: secondaryActionTitle,
          secondaryAction: {
            isPresented = false
            secondaryAction?()
          },
          dismissAction: {
            isPresented = false
          }
        )
        .transition(.scale(scale: 0.95).combined(with: .opacity))
      }
    }
    .animation(.spring(response: 0.25, dampingFraction: 0.8), value: isPresented)
  }
}

extension View {
  /// Presents a Neo-Brutalist error dialog overriding the standard iOS alert
  func winSystemError(
    isPresented: Binding<Bool>,
    title: String = "Something went wrong :(",
    message: String,
    primaryActionTitle: String = "Go Back",
    primaryAction: @escaping () -> Void = {},
    secondaryActionTitle: String? = "Try again(?)",
    secondaryAction: (() -> Void)? = nil
  ) -> some View {
    self.modifier(
      WinSystemErrorModifier(
        isPresented: isPresented,
        title: title,
        message: message,
        primaryActionTitle: primaryActionTitle,
        primaryAction: primaryAction,
        secondaryActionTitle: secondaryActionTitle,
        secondaryAction: secondaryAction
      )
    )
  }
}
