//
//  CredentialImportFlowSheet.swift
//  solidarity
//
//  UI flow for OID4VCI credential import: review offer → authenticate → fetch → done.
//

import SwiftUI

struct CredentialImportFlowSheet: View {
  enum Step {
    case loading
    case review(CredentialOffer)
    case pinEntry(CredentialOffer)
    case fetching
    case success(String)
    case error(String)
  }

  let offerURL: String
  @Environment(\.dismiss) private var dismiss
  @State private var step: Step = .loading
  @State private var userPin = ""

  private let service = CredentialIssuanceService.shared

  var body: some View {
    NavigationStack {
      VStack(spacing: 16) {
        switch step {
        case .loading:
          loadingView

        case .review(let offer):
          reviewView(offer)

        case .pinEntry(let offer):
          pinEntryView(offer)

        case .fetching:
          fetchingView

        case .success(let message):
          successView(message)

        case .error(let message):
          errorView(message)
        }
      }
      .padding(16)
      .navigationTitle("Receive Credential")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button("Close") { dismiss() }
        }
      }
      .onAppear { parseOffer() }
    }
  }

  // MARK: - Step Views

  private var loadingView: some View {
    VStack(spacing: 20) {
      Spacer()
      ProgressView()
        .scaleEffect(1.5)
        .tint(Color.Theme.terminalGreen)
      Text("Parsing credential offer...")
        .font(.system(size: 14, design: .monospaced))
        .foregroundColor(Color.Theme.textSecondary)
      Spacer()
    }
  }

  private func reviewView(_ offer: CredentialOffer) -> some View {
    VStack(spacing: 16) {
      VStack(alignment: .leading, spacing: 12) {
        Text("— ISSUER")
          .font(.system(size: 11, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)

        Label(issuerDisplayName(offer), systemImage: "building.2")
          .font(.system(size: 16, weight: .semibold, design: .monospaced))
          .foregroundColor(Color.Theme.terminalGreen)

        Divider().overlay(Color.Theme.divider)

        Text("— CREDENTIALS OFFERED")
          .font(.system(size: 11, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)

        ForEach(offer.credentialConfigurationIds, id: \.self) { credType in
          Label(credType.replacingOccurrences(of: "Credential", with: " Credential"), systemImage: "doc.badge.plus")
            .font(.system(size: 14))
            .foregroundColor(Color.Theme.textPrimary)
        }

        if offer.preAuthorizedCode != nil {
          Divider().overlay(Color.Theme.divider)

          HStack(spacing: 6) {
            Image(systemName: "checkmark.shield.fill")
              .foregroundColor(Color.Theme.terminalGreen)
              .font(.system(size: 12))
            Text("Pre-authorized")
              .font(.system(size: 12, weight: .bold, design: .monospaced))
              .foregroundColor(Color.Theme.terminalGreen)
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(16)
      .background(Color.Theme.searchBg)
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))

      Spacer()

      Button("Accept & Import") {
        if offer.userPinRequired {
          step = .pinEntry(offer)
        } else {
          startIssuance(offer: offer)
        }
      }
      .buttonStyle(ThemedPrimaryButtonStyle())

      Button("Decline") { dismiss() }
        .font(.system(size: 14, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textSecondary)
    }
  }

  private func pinEntryView(_ offer: CredentialOffer) -> some View {
    VStack(spacing: 20) {
      Spacer()

      Image(systemName: "lock.rectangle")
        .font(.system(size: 48))
        .foregroundColor(Color.Theme.terminalGreen)

      Text("Issuer requires a PIN")
        .font(.system(size: 18, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textPrimary)

      TextField("Enter PIN", text: $userPin)
        .textFieldStyle(.roundedBorder)
        .keyboardType(.numberPad)
        .frame(maxWidth: 200)

      Spacer()

      Button("Submit") {
        startIssuance(offer: offer, pin: userPin)
      }
      .buttonStyle(ThemedPrimaryButtonStyle())
      .disabled(userPin.isEmpty)
    }
  }

  private var fetchingView: some View {
    VStack(spacing: 20) {
      Spacer()

      ProgressView()
        .scaleEffect(1.5)
        .tint(Color.Theme.terminalGreen)

      Text("Fetching Credential")
        .font(.system(size: 18, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textPrimary)

      Text("Authenticating and downloading from issuer.")
        .font(.system(size: 13))
        .foregroundColor(Color.Theme.textSecondary)
        .multilineTextAlignment(.center)

      Spacer()
    }
  }

  private func successView(_ message: String) -> some View {
    VStack(spacing: 16) {
      Spacer()

      Image(systemName: "checkmark.seal.fill")
        .font(.system(size: 48))
        .foregroundColor(Color.Theme.terminalGreen)

      Text("Credential Received")
        .font(.system(size: 20, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textPrimary)

      Text(message)
        .font(.system(size: 14))
        .foregroundColor(Color.Theme.textSecondary)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 16)

      Spacer()

      Button("Done") { dismiss() }
        .buttonStyle(ThemedPrimaryButtonStyle())
    }
  }

  private func errorView(_ message: String) -> some View {
    VStack(spacing: 16) {
      Spacer()

      Image(systemName: "xmark.seal")
        .font(.system(size: 48))
        .foregroundColor(.red)

      Text("Import Failed")
        .font(.system(size: 20, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textPrimary)

      Text(message)
        .font(.system(size: 14))
        .foregroundColor(Color.Theme.textSecondary)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 16)

      Spacer()

      Button("Retry") { parseOffer() }
        .buttonStyle(ThemedPrimaryButtonStyle())

      Button("Close") { dismiss() }
        .font(.system(size: 14, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textSecondary)
    }
  }

  // MARK: - Actions

  private func parseOffer() {
    step = .loading
    Task {
      let result = await service.parseOfferAsync(from: offerURL)
      await MainActor.run {
        switch result {
        case .success(let offer):
          step = .review(offer)
        case .failure(let error):
          step = .error(error.localizedDescription)
        }
      }
    }
  }

  private func startIssuance(offer: CredentialOffer, pin: String? = nil) {
    step = .fetching

    Task {
      // Biometric gate before signing proof
      let authResult = await withCheckedContinuation { continuation in
        BiometricGatekeeper.shared.authorizeIfRequired(.presentProof) { result in
          continuation.resume(returning: result)
        }
      }

      guard case .success = authResult else {
        await MainActor.run {
          if case .failure(let error) = authResult {
            step = .error(error.localizedDescription)
          }
        }
        return
      }

      // Run token + credential flow
      let tokenResult = await service.requestToken(offer: offer, userPin: pin)
      guard case .success(let tokenResponse) = tokenResult else {
        await MainActor.run {
          if case .failure(let error) = tokenResult {
            step = .error(error.localizedDescription)
          }
        }
        return
      }

      let credResult = await service.requestCredential(offer: offer, tokenResponse: tokenResponse)
      await MainActor.run {
        switch credResult {
        case .success(let issuance):
          // Store locally
          let storeResult = service.storeCredential(issuance)
          switch storeResult {
          case .success:
            let typeName = offer.credentialConfigurationIds.first ?? "Credential"
            step = .success("Stored \(typeName) from \(issuerDisplayName(offer))")
          case .failure(let error):
            step = .error("Credential received but storage failed: \(error.localizedDescription)")
          }
        case .failure(let error):
          step = .error(error.localizedDescription)
        }
      }
    }
  }

  private func issuerDisplayName(_ offer: CredentialOffer) -> String {
    URL(string: offer.credentialIssuer)?.host ?? offer.credentialIssuer
  }
}
