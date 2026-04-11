import SwiftUI

extension OnboardingFlowView {

  // MARK: - Secure Keys Step

  var finalizeKeysStep: some View {
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

  var importContactsStep: some View {
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
          Button(action: { showingContactPicker = true }) {
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

  // MARK: - Scan Passport Step

  var scanPassportStep: some View {
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

  var finalCompletionStep: some View {
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

  func completionRow(title: String, done: Bool, detail: String) -> some View {
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
}
