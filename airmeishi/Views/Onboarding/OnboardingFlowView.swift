import SwiftUI

struct OnboardingFlowView: View {
  enum Step: Int, CaseIterable {
    case welcome
    case profileSetup
    case avatarSetup
    case secureKeys
    case complete
  }

  @AppStorage("solidarity.onboarding.completed") private var onboardingCompleted = false
  @AppStorage("theme_selected_animal") private var savedAvatar: String?
  @AppStorage("user_profile_name") private var profileName = ""

  @State private var step: Step = .welcome
  
  // Profile Form Data
  @State private var username = ""
  @State private var linkText = ""
  @State private var xTwitter = ""
  @State private var linkedIn = ""
  @State private var wallet = ""
  @State private var selectedAvatar: AnimalCharacter?

  @State private var isWorking = false
  @State private var showingAlert = false
  @State private var alertMessage = ""

  var body: some View {
    ZStack {
      Color.Theme.pageBg.ignoresSafeArea()
      
      switch step {
      case .welcome:
        TerminalWelcomeScreen {
          withAnimation(.easeInOut) { step = .profileSetup }
        }
      case .profileSetup:
        DarkProfileSetupForm(
          onNext: {
            profileName = username // Save name
            withAnimation(.easeInOut) { step = .avatarSetup }
          },
          username: $username,
          link: $linkText,
          xTwitter: $xTwitter,
          linkedIn: $linkedIn,
          wallet: $wallet
        )
      case .avatarSetup:
        AvatarSelectionGrid(
          selectedAvatar: $selectedAvatar,
          onNext: {
            if let avatar = selectedAvatar {
              savedAvatar = avatar.rawValue
            }
            withAnimation(.easeInOut) { step = .secureKeys }
          },
          onBack: {
            withAnimation(.easeInOut) { step = .profileSetup }
          }
        )
      case .secureKeys:
        finalizeKeysStep
      case .complete:
        finalCompletionStep
      }
    }
    .alert("Onboarding Error", isPresented: $showingAlert) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(alertMessage)
    }
  }

  private var finalizeKeysStep: some View {
    VStack(alignment: .leading, spacing: 24) {
      HStack {
        Button(action: { withAnimation { step = .avatarSetup } }) {
          Image(systemName: "chevron.left")
            .foregroundColor(.white)
            .padding(12)
            .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
        }
        Spacer()
      }
      .padding(.top, 40)
      
      VStack(alignment: .leading, spacing: 8) {
        Text("Final step")
          .font(.system(size: 28, weight: .bold))
          .foregroundColor(.white)
        Text("You're about to begin your journey.\nPlease confirm to generate your DID keys.")
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textSecondary)
      }
      
      Spacer()
      
      if isWorking {
        ProgressView()
          .progressViewStyle(CircularProgressViewStyle(tint: .white))
          .scaleEffect(1.5)
          .frame(maxWidth: .infinity)
      } else {
        Button(action: setupKeychain) {
          Text("Generate Secure Keys")
        }
        .buttonStyle(ThemedInvertedButtonStyle())
      }
      
      Spacer()
    }
    .padding(.horizontal, 24)
  }
  
  private var finalCompletionStep: some View {
    VStack(spacing: 24) {
      Spacer()
      Text("[ SYSTEM READY ]")
        .font(.system(size: 32, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.terminalGreen)
        .shadow(color: Color.Theme.terminalGreen.opacity(0.5), radius: 10)
      
      Spacer()
      
      Button(action: {
        HapticFeedbackManager.shared.successNotification()
        onboardingCompleted = true
      }) {
        Text("Enter Solidarity")
      }
      .buttonStyle(ThemedInvertedButtonStyle())
    }
    .padding(24)
  }

  private func setupKeychain() {
    isWorking = true
    BiometricGatekeeper.shared.authorize(.rotateMasterKey) { result in
      switch result {
      case .failure(let error):
        isWorking = false
        show(error.localizedDescription)
      case .success:
        let keyResult = KeychainService.shared.ensureSigningKey()
        switch keyResult {
        case .failure(let error):
          isWorking = false
          show(error.localizedDescription)
        case .success:
          let pairwiseResult = KeychainService.shared.ensurePairwiseKey(for: "solidarity.gg")
          isWorking = false
          switch pairwiseResult {
          case .success:
            withAnimation { step = .complete }
          case .failure(let error):
            show(error.localizedDescription)
          }
        }
      }
    }
  }

  private func show(_ message: String) {
    alertMessage = message
    showingAlert = true
  }
}
