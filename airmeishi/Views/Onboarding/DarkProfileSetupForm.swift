import SwiftUI

struct DarkProfileSetupForm: View {
  let onNext: () -> Void
  @Binding var username: String
  @Binding var link: String
  @Binding var xTwitter: String
  @Binding var linkedIn: String
  @Binding var wallet: String

  @State private var hasAttemptedNext = false
  @FocusState private var focusedField: Field?

  private enum Field: Hashable {
    case username, link, xTwitter, linkedIn, wallet
  }

  var body: some View {
    ScrollView {
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
          placeholder: "Enter your username",
          text: $username,
          isRequired: true,
          errorMessage: (hasAttemptedNext && username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) ? "Username is required" : nil
        )
        .focused($focusedField, equals: .username)
        .submitLabel(.next)
        .onSubmit { focusedField = .link }

        // Link field
        DarkInputField(
          title: "Link",
          placeholder: "https://yoursite.com",
          text: $link,
          isRequired: false
        )
        .focused($focusedField, equals: .link)
        .submitLabel(.next)
        .onSubmit { focusedField = .xTwitter }
        .keyboardType(.URL)
        .textInputAutocapitalization(.never)

        // X field
        DarkInputField(
          title: "X(twitter)",
          placeholder: "https://x.com/username",
          text: $xTwitter,
          isRequired: false
        )
        .focused($focusedField, equals: .xTwitter)
        .submitLabel(.next)
        .onSubmit { focusedField = .linkedIn }
        .textInputAutocapitalization(.never)

        // LinkedIn field
        DarkInputField(
          title: "LinkedIn",
          placeholder: "linkedin/links/here",
          text: $linkedIn,
          isRequired: false
        )
        .focused($focusedField, equals: .linkedIn)
        .submitLabel(.next)
        .onSubmit { focusedField = .wallet }
        .textInputAutocapitalization(.never)

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
        .focused($focusedField, equals: .wallet)
        .submitLabel(.done)
        .onSubmit { focusedField = nil }
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()

        Spacer(minLength: 40)

        Button(action: {
          hasAttemptedNext = true
          focusedField = nil
          if !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
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
    }
    .scrollDismissesKeyboard(.interactively)
    .background(Color.Theme.pageBg.ignoresSafeArea())
    .toolbar {
      ToolbarItemGroup(placement: .keyboard) {
        Spacer()
        Button("Done") {
          focusedField = nil
        }
        .foregroundColor(Color.Theme.primaryBlue)
      }
    }
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
      HStack(spacing: 4) {
        Text(title)
          .font(.system(size: 14, weight: .bold))
          .foregroundColor(.white)
        if isRequired {
          Text("*")
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(Color.Theme.destructive)
        }
      }

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
