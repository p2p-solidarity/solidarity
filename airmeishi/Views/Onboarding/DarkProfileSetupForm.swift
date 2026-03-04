import SwiftUI

struct DarkProfileSetupForm: View {
  let onNext: () -> Void
  @Binding var username: String
  @Binding var link: String
  @Binding var xTwitter: String
  @Binding var linkedIn: String
  @Binding var wallet: String

  @State private var hasAttemptedNext = false

  var body: some View {
    VStack(alignment: .leading, spacing: 24) {

      VStack(alignment: .center, spacing: 8) {
        Text("Hi,")
          .font(.system(size: 28, weight: .bold))
          .foregroundColor(.white)
        Text("It's good to have you here <3\nLet's set up your profile")
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textSecondary)
          .multilineTextAlignment(.center)
      }
      .frame(maxWidth: .infinity)
      .padding(.bottom, 24)

      // Username field
      DarkInputField(
        title: "Choose your username",
        placeholder: "Enter you username",
        text: $username,
        isRequired: true,
        errorMessage: (hasAttemptedNext && username.isEmpty) ? "Dude, you need the name" : nil
      )

      // Link field
      DarkInputField(
        title: "Link",
        placeholder: "Enter you username", // keeping typo from reference or leave as is
        text: $link,
        isRequired: false,
        errorMessage: (hasAttemptedNext && link.count == 1) ? "Error" : nil // Fake logic just for demo error state
      )

      // X field
      DarkInputField(
        title: "X(twitter)",
        placeholder: "https://x.com/username",
        text: $xTwitter,
        isRequired: false
      )

      // LinkedIn field
      DarkInputField(
        title: "LinkedIn",
        placeholder: "linkedin/links/here",
        text: $linkedIn,
        isRequired: false
      )

      VStack(alignment: .leading, spacing: 4) {
        Text("Export")
          .font(.system(size: 14, weight: .bold))
          .foregroundColor(.white)
        Text("You can do this later or whenever you're ready to export your data.")
          .font(.system(size: 12))
          .foregroundColor(Color.Theme.textTertiary)
      }

      // Wallet field
      DarkInputField(
        title: "Link to your ERC20 wallet (?)",
        placeholder: "0x...",
        text: $wallet,
        isRequired: false
      )

      Spacer(minLength: 40)

      Button(action: {
        hasAttemptedNext = true
        if !username.isEmpty {
          HapticFeedbackManager.shared.heavyImpact()
          onNext()
        } else {
          HapticFeedbackManager.shared.errorNotification()
        }
      }) {
        Text("Next")
      }
      .buttonStyle(ThemedInvertedButtonStyle())
      .padding(.bottom, 32)
    }
    .padding(.horizontal, 24)
    .padding(.top, 40)
    .background(Color.Theme.pageBg.ignoresSafeArea())
  }
}

// Custom simple input field for the form
struct DarkInputField: View {
  let title: String
  let placeholder: String
  @Binding var text: String
  var isRequired: Bool = false
  var errorMessage: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title)
        .font(.system(size: 14, weight: .bold))
        .foregroundColor(.white)

      TextField("", text: $text)
        .placeholder(when: text.isEmpty) {
          Text(placeholder).foregroundColor(Color.Theme.textPlaceholder)
        }
        .padding(14)
        .foregroundColor(.white)
        .background(Color.clear)
        .overlay(
          Rectangle()
            .stroke(errorMessage != nil ? Color.Theme.destructive : Color.Theme.divider, lineWidth: 1)
        )

      if let error = errorMessage {
        Text(error)
          .font(.system(size: 12, weight: .bold))
          .foregroundColor(Color.Theme.destructive)
      }
    }
  }
}

extension View {
  func placeholder<Content: View>(
    when shouldShow: Bool,
    alignment: Alignment = .leading,
    @ViewBuilder placeholder: () -> Content) -> some View {

      ZStack(alignment: alignment) {
        placeholder().opacity(shouldShow ? 1 : 0)
        self
      }
  }
}

#Preview {
  DarkProfileSetupForm(onNext: {}, username: .constant(""), link: .constant(""), xTwitter: .constant(""), linkedIn: .constant(""), wallet: .constant(""))
}
