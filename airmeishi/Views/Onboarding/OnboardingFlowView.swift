import SwiftUI

struct OnboardingFlowView: View {
  enum Step: Int, CaseIterable {
    case welcome
    case profileSetup
    case avatarSetup
    case secureKeys
    case importContacts
    case scanPassport
    case complete
  }

  @AppStorage("solidarity.onboarding.completed") private var onboardingCompleted = false
  @AppStorage("theme_selected_animal") private var savedAvatar: String?
  @AppStorage("user_profile_name") private var profileName = ""
  @AppStorage("solidarity.onboarding.step") private var persistedStep: Int = 0

  private var step: Step {
    get { Step(rawValue: persistedStep) ?? .welcome }
  }

  private func goTo(_ newStep: Step) {
    withAnimation(.easeInOut) {
      persistedStep = newStep.rawValue
    }
  }

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

  // Import Contacts
  @State private var importedCount: Int?
  @State private var showingVCFPicker = false

  // Passport Scan
  @State private var showingPassportFlow = false
  @State private var passportScanned = false

  // Completion tracking
  @State private var keysGenerated = false

  var body: some View {
    ZStack {
      Color.Theme.pageBg.ignoresSafeArea()

      switch step {
      case .welcome:
        TerminalWelcomeScreen {
          goTo(.profileSetup)
        }
      case .profileSetup:
        DarkProfileSetupForm(
          onNext: {
            profileName = username
            goTo(.avatarSetup)
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
            goTo(.secureKeys)
          },
          onBack: {
            goTo(.profileSetup)
          }
        )
      case .secureKeys:
        finalizeKeysStep
      case .importContacts:
        importContactsStep
      case .scanPassport:
        scanPassportStep
      case .complete:
        finalCompletionStep
      }
    }
    .alert("Onboarding Error", isPresented: $showingAlert) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(alertMessage)
    }
    .sheet(isPresented: $showingVCFPicker) {
      VCFDocumentPicker { url in
        handleVCFImport(url: url)
      }
    }
    .fullScreenCover(isPresented: $showingPassportFlow) {
      PassportOnboardingFlowView { _ in
        passportScanned = true
        showingPassportFlow = false
        goTo(.complete)
      }
    }
  }

  // MARK: - Secure Keys Step

  private var finalizeKeysStep: some View {
    VStack(alignment: .leading, spacing: 24) {
      HStack {
        Button(action: { goTo(.avatarSetup) }) {
          Image(systemName: "chevron.left")
            .foregroundColor(Color.Theme.textPrimary)
            .padding(12)
            .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
        }
        Spacer()
      }
      .padding(.top, 40)

      VStack(alignment: .leading, spacing: 8) {
        Text("Secure Keys")
          .font(.system(size: 28, weight: .bold))
          .foregroundColor(Color.Theme.textPrimary)
        Text("You're about to begin your journey.\nPlease confirm to generate your DID keys.")
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textSecondary)
      }

      Spacer()

      if isWorking {
        ProgressView()
          .progressViewStyle(CircularProgressViewStyle(tint: Color.Theme.terminalGreen))
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

  // MARK: - Import Contacts Step

  private var importContactsStep: some View {
    VStack(alignment: .leading, spacing: 24) {
      HStack {
        Button(action: { goTo(.secureKeys) }) {
          Image(systemName: "chevron.left")
            .foregroundColor(Color.Theme.textPrimary)
            .padding(12)
            .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
        }
        Spacer()
      }
      .padding(.top, 40)

      VStack(alignment: .leading, spacing: 8) {
        Text("Import Contacts")
          .font(.system(size: 28, weight: .bold))
          .foregroundColor(Color.Theme.textPrimary)
        Text("Bring your existing contacts into Solidarity.\nYou can always import more later.")
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textSecondary)
      }

      Spacer()

      VStack(spacing: 16) {
        if let count = importedCount {
          HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
              .foregroundColor(Color.Theme.terminalGreen)
            Text("Imported \(count) contacts")
              .font(.system(size: 16, weight: .semibold, design: .monospaced))
              .foregroundColor(Color.Theme.terminalGreen)
          }
          .padding(.vertical, 10)
          .frame(maxWidth: .infinity)
          .background(Color.Theme.terminalGreen.opacity(0.08))
          .overlay(Rectangle().stroke(Color.Theme.terminalGreen.opacity(0.3), lineWidth: 1))
        }

        if isWorking {
          ProgressView()
            .progressViewStyle(CircularProgressViewStyle(tint: Color.Theme.terminalGreen))
            .scaleEffect(1.2)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
        } else {
          Button(action: importFromPhone) {
            Label("Import from Phone", systemImage: "person.crop.circle.badge.plus")
          }
          .buttonStyle(ThemedPrimaryButtonStyle())

          Button(action: { showingVCFPicker = true }) {
            Label("Import VCF File", systemImage: "doc.badge.plus")
          }
          .buttonStyle(ThemedSecondaryButtonStyle())
        }
      }

      Spacer()

      Button(action: { goTo(.scanPassport) }) {
        Text(importedCount != nil ? "Continue" : "Skip")
      }
      .buttonStyle(ThemedInvertedButtonStyle())
    }
    .padding(.horizontal, 24)
  }

  // MARK: - Scan Passport Step [O-4]

  private var scanPassportStep: some View {
    VStack(alignment: .leading, spacing: 24) {
      HStack {
        Button(action: { goTo(.importContacts) }) {
          Image(systemName: "chevron.left")
            .foregroundColor(Color.Theme.textPrimary)
            .padding(12)
            .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
        }
        Spacer()
      }
      .padding(.top, 40)

      VStack(alignment: .leading, spacing: 8) {
        Text("Scan Passport")
          .font(.system(size: 28, weight: .bold))
          .foregroundColor(Color.Theme.textPrimary)
        Text("Scan your passport to unlock provable claims.\nYou can prove your age or personhood without revealing personal info.")
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textSecondary)
      }

      Spacer()

      VStack(spacing: 16) {
        if passportScanned {
          HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
              .foregroundColor(Color.Theme.terminalGreen)
            Text("Passport credential created")
              .font(.system(size: 16, weight: .semibold, design: .monospaced))
              .foregroundColor(Color.Theme.terminalGreen)
          }
          .padding(.vertical, 10)
          .frame(maxWidth: .infinity)
          .background(Color.Theme.terminalGreen.opacity(0.08))
          .overlay(Rectangle().stroke(Color.Theme.terminalGreen.opacity(0.3), lineWidth: 1))
        }

        if !passportScanned {
          Button(action: { showingPassportFlow = true }) {
            Label("Scan Passport", systemImage: "doc.viewfinder")
          }
          .buttonStyle(ThemedPrimaryButtonStyle())
        }
      }

      Spacer()

      Button(action: { goTo(.complete) }) {
        Text(passportScanned ? "Continue" : "Skip")
      }
      .buttonStyle(ThemedInvertedButtonStyle())
    }
    .padding(.horizontal, 24)
  }

  // MARK: - Dynamic Completion Step

  private var finalCompletionStep: some View {
    VStack(spacing: 24) {
      Spacer()

      Text("[ SYSTEM READY ]")
        .font(.system(size: 32, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.terminalGreen)
        .shadow(color: Color.Theme.terminalGreen.opacity(0.5), radius: 10)

      VStack(alignment: .leading, spacing: 12) {
        completionRow(
          title: "Profile",
          done: !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          detail: username.isEmpty ? "Not set" : username
        )
        completionRow(
          title: "Key Pair",
          done: keysGenerated,
          detail: keysGenerated ? "Generated" : "Not created"
        )
        completionRow(
          title: "Contacts",
          done: (importedCount ?? 0) > 0,
          detail: importedCount.map { "\($0) imported" } ?? "Skipped"
        )
        completionRow(
          title: "Passport",
          done: passportScanned,
          detail: passportScanned ? "Credential created" : "Skipped"
        )
      }
      .padding(16)
      .background(Color.Theme.searchBg)
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))

      Spacer()

      Button(action: {
        HapticFeedbackManager.shared.successNotification()
        persistedStep = 0
        onboardingCompleted = true
      }) {
        Text("Start Using Solidarity")
      }
      .buttonStyle(ThemedInvertedButtonStyle())
    }
    .padding(24)
  }

  private func completionRow(title: String, done: Bool, detail: String) -> some View {
    HStack(spacing: 10) {
      Image(systemName: done ? "checkmark.circle.fill" : "circle")
        .foregroundColor(done ? Color.Theme.terminalGreen : Color.Theme.textTertiary)
        .font(.system(size: 18))
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.system(size: 14, weight: .semibold, design: .monospaced))
          .foregroundColor(Color.Theme.textPrimary)
        Text(detail)
          .font(.system(size: 12))
          .foregroundColor(Color.Theme.textSecondary)
      }
      Spacer()
    }
  }

  // MARK: - Actions

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
            keysGenerated = true
            createInitialBusinessCard()
            goTo(.importContacts)
          case .failure(let error):
            show(error.localizedDescription)
          }
        }
      }
    }
  }

  private func createInitialBusinessCard() {
    let trimmedName = username.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedName.isEmpty else { return }

    var socials: [SocialNetwork] = []
    if !xTwitter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      socials.append(SocialNetwork(platform: .twitter, username: xTwitter.trimmingCharacters(in: .whitespacesAndNewlines)))
    }
    if !linkedIn.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      socials.append(SocialNetwork(platform: .linkedin, username: linkedIn.trimmingCharacters(in: .whitespacesAndNewlines)))
    }

    var card = BusinessCard(name: trimmedName)
    card.socialNetworks = socials
    card.animal = selectedAvatar

    _ = CardManager.shared.createCard(card)
  }

  private func importFromPhone() {
    isWorking = true
    Task {
      let permResult = await ContactImportService.shared.requestPermission()
      switch permResult {
      case .success(let granted):
        guard granted else {
          await MainActor.run {
            isWorking = false
            show("Please enable Contacts permission in iOS Settings.")
          }
          return
        }
        let importResult = ContactImportService.shared.importContacts()
        await MainActor.run {
          isWorking = false
          switch importResult {
          case .success(let count):
            importedCount = (importedCount ?? 0) + count
          case .failure(let error):
            show(error.localizedDescription)
          }
        }
      case .failure(let error):
        await MainActor.run {
          isWorking = false
          show(error.localizedDescription)
        }
      }
    }
  }

  private func handleVCFImport(url: URL) {
    isWorking = true
    let result = ContactImportService.shared.importFromVCF(url: url)
    isWorking = false
    switch result {
    case .success(let count):
      importedCount = (importedCount ?? 0) + count
    case .failure(let error):
      show(error.localizedDescription)
    }
  }

  private func show(_ message: String) {
    alertMessage = message
    showingAlert = true
  }
}
