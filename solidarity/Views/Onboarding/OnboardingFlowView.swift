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

  @State var detectedICloudBackup: BackupManager.BackupProbe?
  @State var showingICloudRestorePrompt = false
  @State var isRestoringFromICloud = false
  @State var restoreErrorMessage: String?

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
    .alert(
      String(localized: "Restore from iCloud?"),
      isPresented: $showingICloudRestorePrompt,
      presenting: detectedICloudBackup
    ) { probe in
      Button(String(localized: "Restore")) {
        performICloudRestore()
      }
      Button(String(localized: "Start Fresh"), role: .cancel) {
        provisionKeysAndContinue()
      }
    } message: { probe in
      let dateString = probe.timestamp.formatted(date: .abbreviated, time: .shortened)
      Text(String(localized: "We found a backup from \(dateString) in iCloud. Restore your cards, contacts, and credentials?"))
    }
    .alert(
      String(localized: "Restore Failed"),
      isPresented: Binding(
        get: { restoreErrorMessage != nil },
        set: { if !$0 { restoreErrorMessage = nil } }
      )
    ) {
      Button(String(localized: "Continue")) {
        provisionKeysAndContinue()
      }
    } message: {
      Text(restoreErrorMessage ?? "")
    }
    .overlay {
      if isRestoringFromICloud {
        ZStack {
          Color.black.opacity(0.4).ignoresSafeArea()
          VStack(spacing: 12) {
            ProgressView()
              .progressViewStyle(CircularProgressViewStyle(tint: Color.Theme.terminalGreen))
              .scaleEffect(1.4)
            Text(String(localized: "Restoring from iCloud…"))
              .font(.system(size: 14, design: .monospaced))
              .foregroundColor(Color.Theme.textPrimary)
          }
          .padding(24)
          .background(Color.Theme.cardBg)
          .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
        }
      }
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

  /// Entry from the "Generate Secure Keys" button. We probe iCloud Drive for an
  /// existing backup BEFORE provisioning keys so a user moving to a new device
  /// can restore their old DID/credentials instead of generating a fresh
  /// identity that wouldn't match anything in the backup. If no backup exists
  /// (or the probe fails), we fall through to `provisionKeysAndContinue` and
  /// behave like a brand-new install.
  func setupKeychain() {
    isWorking = true
    isRestoringFromICloud = true
    Task { @MainActor in
      let probe = await BackupManager.probeLatestBackup()
      isRestoringFromICloud = false
      isWorking = false
      if let probe = probe {
        detectedICloudBackup = probe
        showingICloudRestorePrompt = true
      } else {
        provisionKeysAndContinue()
      }
    }
  }

  /// Bootstraps the master DID + first pairwise key, then advances to the
  /// contacts-import step. Used both for fresh installs and when the user picks
  /// "Start Fresh" from the iCloud restore prompt. The work hops to a detached
  /// task because `ensureSigningKey()` may briefly block waiting for iCloud
  /// Keychain to deliver a synced master key from another device.
  func provisionKeysAndContinue() {
    isWorking = true
    isRestoringFromICloud = true
    BiometricGatekeeper.shared.authorize(.rotateMasterKey) { result in
      switch result {
      case .failure(let error):
        isWorking = false
        isRestoringFromICloud = false
        show(error.localizedDescription)
      case .success:
        Task { @MainActor in
          let keyResult = await Task.detached(priority: .userInitiated) {
            KeychainService.shared.ensureSigningKey()
          }.value
          switch keyResult {
          case .failure(let error):
            isWorking = false
            isRestoringFromICloud = false
            show(error.localizedDescription)
          case .success:
            let pairwiseResult = await Task.detached(priority: .userInitiated) {
              KeychainService.shared.ensurePairwiseKey(for: "solidarity.gg")
            }.value
            isWorking = false
            isRestoringFromICloud = false
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
  }

  /// Bootstraps keys (waiting briefly for iCloud Keychain to deliver an
  /// existing master key from another device) and then decrypts the iCloud
  /// backup blob. The encryption key now syncs via iCloud Keychain, so the
  /// blob's `EncryptionManager` decryption succeeds on a fresh device.
  func performICloudRestore() {
    isRestoringFromICloud = true
    BiometricGatekeeper.shared.authorize(.rotateMasterKey) { result in
      switch result {
      case .failure(let error):
        isRestoringFromICloud = false
        restoreErrorMessage = error.localizedDescription
      case .success:
        Task { @MainActor in
          let keyResult = await Task.detached(priority: .userInitiated) {
            KeychainService.shared.ensureSigningKey()
          }.value
          switch keyResult {
          case .failure(let error):
            isRestoringFromICloud = false
            restoreErrorMessage = error.localizedDescription
            return
          case .success:
            _ = await Task.detached(priority: .userInitiated) {
              KeychainService.shared.ensurePairwiseKey(for: "solidarity.gg")
            }.value
            let result = await BackupManager.shared.restoreFromBackup()
            isRestoringFromICloud = false
            switch result {
            case .success:
              _ = BackupManager.shared.update { $0.enabled = true }
              IdentityDataStore.shared.refreshAll()
              HapticFeedbackManager.shared.successNotification()
              keysGenerated = true
              persistedStep = 0
              onboardingCompleted = true
            case .failure(let error):
              restoreErrorMessage = error.localizedDescription
            }
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
