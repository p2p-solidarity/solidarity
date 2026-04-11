import SwiftUI

struct ProofPresentationFlowSheet: View {
  enum Step {
    case review
    case signing
    case submitted
  }

  let requestPayload: String
  @Environment(\.dismiss) private var dismiss
  @State private var step: Step = .review
  @State private var submittedToken: String = ""
  @State private var isWorking = false
  @State private var showingAlert = false
  @State private var alertMessage = ""
  @State private var parsedRequest: OIDCService.PresentationRequest?

  private var verifierDomain: String {
    if let uri = parsedRequest?.redirectUri, let host = URL(string: uri)?.host {
      return host
    }
    return OIDCService.verifierDomain(from: requestPayload)
      ?? String(localized: "Unknown verifier")
  }

  private var requestedClaims: [String] {
    parsedRequest?.presentationDefinition.inputDescriptors.compactMap { $0.name ?? $0.purpose } ?? []
  }

  /// Holder DID for the current session, used to collect backing VCs
  /// from the credential vault and resolve verified claims.
  private var currentHolderDid: String? {
    guard case .success(let descriptor) = DIDService().currentDescriptor() else { return nil }
    return descriptor.did
  }

  /// Credentials from VCLibrary owned by this holder that will be batched
  /// into the VP alongside the freshly-issued self-card VC.
  private var backingCredentials: [VCLibrary.StoredCredential] {
    guard let holder = currentHolderDid,
      case .success(let stored) = VCLibrary.shared.list()
    else { return [] }
    return stored.filter { $0.holderDid == holder && $0.status != .revoked }
  }

  var body: some View {
    NavigationStack {
      VStack(spacing: 16) {
        switch step {
        case .review:
          reviewStepView

        case .signing:
          signingStepView

        case .submitted:
          submittedStepView
        }
      }
      .padding(16)
      .navigationTitle("Present Proof")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button("Close") { dismiss() }
        }
      }
      .alert("Proof", isPresented: $showingAlert) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(alertMessage)
      }
      .onAppear { parseRequest() }
    }
  }

  private var reviewStepView: some View {
    VStack(spacing: 16) {
      VStack(alignment: .leading, spacing: 12) {
        Text("— VERIFIER")
          .font(.system(size: 11, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)

        Label(verifierDomain, systemImage: "building.2")
          .font(.system(size: 16, weight: .semibold, design: .monospaced))
          .foregroundColor(Color.Theme.terminalGreen)

        if !requestedClaims.isEmpty {
          Divider().overlay(Color.Theme.divider)

          Text("— REQUESTED CLAIMS")
            .font(.system(size: 11, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.textSecondary)

          ForEach(requestedClaims, id: \.self) { claim in
            Label(claim, systemImage: "checkmark.shield")
              .font(.system(size: 14))
              .foregroundColor(Color.Theme.textPrimary)
          }
        }

        if !backingCredentials.isEmpty {
          Divider().overlay(Color.Theme.divider)

          Text("— CREDENTIALS TO PRESENT")
            .font(.system(size: 11, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.textSecondary)

          Label(
            "Self card (fresh) + \(backingCredentials.count) backing VC\(backingCredentials.count == 1 ? "" : "s")",
            systemImage: "doc.on.doc"
          )
          .font(.system(size: 13, design: .monospaced))
          .foregroundColor(Color.Theme.textPrimary)

          ForEach(backingCredentials, id: \.id) { cred in
            Text("• \(shortIssuer(cred.issuerDid))")
              .font(.system(size: 11, design: .monospaced))
              .foregroundColor(Color.Theme.textTertiary)
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(16)
      .background(Color.Theme.searchBg)
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))

      Button("Sign & Submit") { submit() }
        .buttonStyle(ThemedPrimaryButtonStyle())
        .disabled(isWorking)
    }
  }

  private var signingStepView: some View {
    VStack(spacing: 20) {
      Spacer()

      ProgressView()
        .scaleEffect(1.5)
        .tint(Color.Theme.terminalGreen)

      Text("Signing Proof")
        .font(.system(size: 18, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textPrimary)

      Text("Applying pairwise DID and biometric gate.")
        .font(.system(size: 13))
        .foregroundColor(Color.Theme.textSecondary)
        .multilineTextAlignment(.center)

      Spacer()
    }
  }

  private var submittedStepView: some View {
    VStack(spacing: 16) {
      Spacer()

      Image(systemName: "checkmark.seal.fill")
        .font(.system(size: 48))
        .foregroundColor(Color.Theme.terminalGreen)

      Text("Proof Submitted")
        .font(.system(size: 20, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textPrimary)

      Text("Submitted to \(verifierDomain)")
        .font(.system(size: 14))
        .foregroundColor(Color.Theme.textSecondary)

      Text(String(submittedToken.prefix(80)) + "...")
        .font(.caption.monospaced())
        .foregroundColor(Color.Theme.textTertiary)
        .lineLimit(2)

      Spacer()

      Button("Done") { dismiss() }
        .buttonStyle(ThemedPrimaryButtonStyle())
    }
  }

  private func shortIssuer(_ did: String) -> String {
    guard did.count > 32 else { return did }
    return "\(did.prefix(16))…\(did.suffix(12))"
  }

  private func parseRequest() {
    if case .success(let request) = OIDCService.shared.parseRequest(from: requestPayload) {
      parsedRequest = request
    }
  }

  private func submit() {
    step = .signing
    isWorking = true

    BiometricGatekeeper.shared.authorizeIfRequired(.presentProof) { result in
      switch result {
      case .failure(let error):
        isWorking = false
        alertMessage = error.localizedDescription
        showingAlert = true
        step = .review
      case .success:
        let card = CardManager.shared.businessCards.first ?? BusinessCard(name: String(localized: "Solidarity User"))
        let rpDomain: String? = {
          if let uri = parsedRequest?.redirectUri { return URL(string: uri)?.host }
          return OIDCService.verifierDomain(from: requestPayload)
        }()
        // VC payload must be bounded by what the holder has attested to.
        // We scope to ShareSettingsStore.enabledFields — the user's opt-in
        // share set — so unverified data never enters the signed VP.
        let attestedFields = ShareSettingsStore.enabledFields
        let cardToPresent = card
          .filteredCard(for: attestedFields)
          .withAttestedFields(attestedFields)
        let options = VCService.IssueOptions(relyingPartyDomain: rpDomain)
        switch VCService().issueBusinessCardCredential(for: cardToPresent, options: options) {
        case .failure(let error):
          isWorking = false
          alertMessage = error.localizedDescription
          showingAlert = true
          step = .review
        case .success(let credential):
          // Batch VP: fresh self-card VC + all holder-owned backing VCs
          // from the credential vault (passport L3, institution L2, etc.).
          // One VP signature, many VCs — verifier sees full trust chain.
          var jwts: [String] = [credential.jwt]
          jwts.append(contentsOf: self.backingCredentials.map { $0.jwt })

          let wrapResult = OID4VPPresentationService.shared.wrapCredentialsAsVP(
            vcJwts: jwts,
            options: .init(
              relyingPartyDomain: rpDomain,
              nonce: parsedRequest?.nonce,
              audience: parsedRequest?.clientId
            )
          )

          switch wrapResult {
          case .failure(let error):
            isWorking = false
            alertMessage = error.localizedDescription
            showingAlert = true
            step = .review
          case .success(let vpToken):
            submitToVerifier(jwt: vpToken)
          }
        }
      }
    }
  }

  private func submitToVerifier(jwt: String) {
    guard let request = parsedRequest else {
      isWorking = false
      submittedToken = jwt
      step = .submitted
      return
    }

    Task {
      let result = await OIDCService.shared.submitVpToken(
        token: jwt,
        redirectURI: request.redirectUri,
        state: request.state.isEmpty ? nil : request.state
      )
      await MainActor.run {
        isWorking = false
        switch result {
        case .success:
          submittedToken = jwt
          step = .submitted
        case .failure(let error):
          alertMessage = error.localizedDescription
          showingAlert = true
          step = .review
        }
      }
    }
  }
}
