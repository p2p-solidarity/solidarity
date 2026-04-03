import Contacts
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

  @AppStorage("solidarity.onboarding.completed") var onboardingCompleted = false
  @AppStorage("theme_selected_animal") var savedAvatar: String?
  @AppStorage("user_profile_name") var profileName = ""
  @AppStorage("solidarity.onboarding.step") var persistedStep: Int = 0

  var step: Step {
    Step(rawValue: persistedStep) ?? .welcome
  }

  func goTo(_ newStep: Step) {
    withAnimation(.easeInOut) {
      persistedStep = newStep.rawValue
    }
  }

  @State var username = ""
  @State var linkText = ""
  @State var xTwitter = ""
  @State var linkedIn = ""
  @State var wallet = ""
  @State var selectedAvatar: AnimalCharacter?

  @State var isWorking = false
  @State var showingAlert = false
  @State var alertMessage = ""

  @State var importedCount: Int?
  @State var showingVCFPicker = false
  @State var showingContactPicker = false

  @State var showingPassportFlow = false
  @State var passportScanned = false

  @State var keysGenerated = false

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
    .sheet(isPresented: $showingContactPicker) {
      ContactPickerView { contacts in
        handlePickedContacts(contacts)
      }
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

  // MARK: - Actions

  func setupKeychain() {
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

  func createInitialBusinessCard() {
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

  func handlePickedContacts(_ contacts: [CNContact]) {
    let result = ContactImportService.shared.importPickedContacts(contacts)
    switch result {
    case .success(let count):
      importedCount = (importedCount ?? 0) + count
    case .failure(let error):
      show(error.localizedDescription)
    }
  }

  func handleVCFImport(url: URL) {
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

  func show(_ message: String) {
    alertMessage = message
    showingAlert = true
  }
}
