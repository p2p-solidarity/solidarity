import SwiftUI

struct OnboardingFlowView: View {
  enum Step: Int, CaseIterable {
    case welcome
    case keySetup
    case contactImport
    case passportPrompt
    case complete
  }

  @AppStorage("solidarity.onboarding.completed") private var onboardingCompleted = false

  @State private var step: Step = .welcome
  @State private var keySetupReady = false
  @State private var importedContactCount = 0
  @State private var passportProof: PassportProofResult?
  @State private var showingPassportFlow = false
  @State private var isWorking = false
  @State private var showingAlert = false
  @State private var alertMessage = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 16) {
          stepHeader
          stepContent
          stepFooter
        }
        .padding(16)
      }
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("Welcome")
      .navigationBarTitleDisplayMode(.inline)
      .sheet(isPresented: $showingPassportFlow) {
        PassportOnboardingFlowView { proof in
          passportProof = proof
        }
      }
      .alert("Onboarding", isPresented: $showingAlert) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(alertMessage)
      }
    }
  }

  private var stepHeader: some View {
    VStack(alignment: .leading, spacing: 10) {
      SolidarityPlaceholderCard(
        screenID: currentScreenID,
        title: currentTitle,
        subtitle: currentSubtitle
      )

      ProgressView(value: Double(step.rawValue + 1), total: Double(Step.allCases.count))
        .tint(Color.Theme.darkUI)
    }
  }

  @ViewBuilder
  private var stepContent: some View {
    switch step {
    case .welcome:
      welcomeStep
    case .keySetup:
      keySetupStep
    case .contactImport:
      contactImportStep
    case .passportPrompt:
      passportPromptStep
    case .complete:
      completionStep
    }
  }

  private var stepFooter: some View {
    HStack {
      if step != .welcome {
        Button("Back") {
          moveBack()
        }
        .buttonStyle(ThemedSecondaryButtonStyle())
      }

      Button(stepButtonTitle) {
        handleNext()
      }
      .buttonStyle(ThemedPrimaryButtonStyle())
      .disabled(isNextDisabled || isWorking)
    }
  }

  private var welcomeStep: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Build your verified social graph with privacy-first identity.")
        .font(.subheadline)
        .foregroundColor(Color.Theme.textSecondary)
      Text("You will set up your key, import contacts, and prepare your passport credential.")
        .font(.caption)
        .foregroundColor(Color.Theme.textTertiary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(14)
    .background(Color.Theme.cardBg)
    .cornerRadius(10)
  }

  private var keySetupStep: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Create and unlock your DID master key.")
        .font(.subheadline)
        .foregroundColor(Color.Theme.textSecondary)

      Label(
        keySetupReady ? "Master key is ready" : "Master key not set",
        systemImage: keySetupReady ? "checkmark.circle.fill" : "exclamationmark.circle"
      )
      .foregroundColor(keySetupReady ? .green : .orange)
      .font(.caption.weight(.semibold))

      Button {
        setupKeychain()
      } label: {
        Text("Authenticate and Setup Key")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(ThemedPrimaryButtonStyle())
      .disabled(isWorking)
    }
    .padding(14)
    .background(Color.Theme.cardBg)
    .cornerRadius(10)
  }

  private var contactImportStep: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Import existing contacts as a bootstrap for your graph.")
        .font(.subheadline)
        .foregroundColor(Color.Theme.textSecondary)

      Label(
        "Imported \(importedContactCount) contacts",
        systemImage: importedContactCount > 0 ? "person.2.fill" : "person.2"
      )
      .font(.caption.weight(.semibold))
      .foregroundColor(Color.Theme.textSecondary)

      Button {
        importContacts()
      } label: {
        Text("Import Contacts")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(ThemedPrimaryButtonStyle())
      .disabled(isWorking)
    }
    .padding(14)
    .background(Color.Theme.cardBg)
    .cornerRadius(10)
  }

  private var passportPromptStep: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Scan your passport to unlock high-trust proofs.")
        .font(.subheadline)
        .foregroundColor(Color.Theme.textSecondary)

      Label(
        passportProof == nil ? "Passport not configured" : "Passport credential saved",
        systemImage: passportProof == nil ? "passport" : "checkmark.seal.fill"
      )
      .foregroundColor(passportProof == nil ? .orange : .green)
      .font(.caption.weight(.semibold))

      if let passportProof {
        Text(passportProof.generationFailed ? "Fallback: SD-JWT mode" : "ZK proof generation completed")
          .font(.caption)
          .foregroundColor(Color.Theme.textSecondary)
      }

      Button {
        showingPassportFlow = true
      } label: {
        Text("Start Passport Flow")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(ThemedPrimaryButtonStyle())

      if passportProof == nil {
        Button {
          handleNext()
        } label: {
          Text("Skip for now")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(ThemedSecondaryButtonStyle())
      }
    }
    .padding(14)
    .background(Color.Theme.cardBg)
    .cornerRadius(10)
  }

  private var completionStep: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("You're all set.")
        .font(.headline)
      Text("Key ready, contacts imported, and identity proofs prepared.")
        .font(.subheadline)
        .foregroundColor(Color.Theme.textSecondary)

      completionRow("Master key", done: keySetupReady)
      completionRow("Contacts", done: importedContactCount >= 0)
      completionRow("Passport", done: passportProof != nil)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(14)
    .background(Color.Theme.cardBg)
    .cornerRadius(10)
  }

  private func completionRow(_ title: String, done: Bool) -> some View {
    HStack {
      Image(systemName: done ? "checkmark.circle.fill" : "circle")
      Text(title)
      Spacer()
    }
    .font(.caption.weight(.semibold))
    .foregroundColor(done ? .green : Color.Theme.textSecondary)
  }

  private var currentScreenID: SolidarityScreenID {
    switch step {
    case .welcome: return .onboardingWelcome
    case .keySetup: return .onboardingKeySetup
    case .contactImport: return .onboardingContactImport
    case .passportPrompt: return .onboardingPassportPrompt
    case .complete: return .onboardingComplete
    }
  }

  private var currentTitle: String {
    switch step {
    case .welcome: return "Welcome to Solidarity"
    case .keySetup: return "Key Setup"
    case .contactImport: return "Import Contacts"
    case .passportPrompt: return "Passport Prompt"
    case .complete: return "Setup Complete"
    }
  }

  private var currentSubtitle: String {
    switch step {
    case .welcome:
      return "Start your first-run journey."
    case .keySetup:
      return "Initialize `solidarity.master` and biometric handshake."
    case .contactImport:
      return "Optional graph bootstrap from address book."
    case .passportPrompt:
      return "Run MRZ + NFC + proof pipeline."
    case .complete:
      return "Enter app with v1 identity foundations."
    }
  }

  private var stepButtonTitle: String {
    switch step {
    case .complete:
      return "Enter App"
    default:
      return "Next"
    }
  }

  private var isNextDisabled: Bool {
    switch step {
    case .keySetup:
      return !keySetupReady
    default:
      return false
    }
  }

  private func moveBack() {
    guard let current = Step(rawValue: step.rawValue - 1) else { return }
    step = current
  }

  private func handleNext() {
    if step == .complete {
      onboardingCompleted = true
      return
    }
    guard let next = Step(rawValue: step.rawValue + 1) else { return }
    step = next
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
            keySetupReady = true
          case .failure(let error):
            show(error.localizedDescription)
          }
        }
      }
    }
  }

  private func importContacts() {
    isWorking = true
    Task {
      let permission = await ContactImportService.shared.requestPermission()
      switch permission {
      case .failure(let error):
        isWorking = false
        show(error.localizedDescription)
      case .success(let granted):
        guard granted else {
          isWorking = false
          show("Contacts access was denied.")
          return
        }
        let importResult = ContactImportService.shared.importContacts()
        isWorking = false
        switch importResult {
        case .success(let count):
          importedContactCount = count
        case .failure(let error):
          show(error.localizedDescription)
        }
      }
    }
  }

  private func show(_ message: String) {
    alertMessage = message
    showingAlert = true
  }
}
