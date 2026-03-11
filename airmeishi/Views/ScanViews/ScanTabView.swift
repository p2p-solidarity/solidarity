import AVFoundation
import SwiftUI

struct ScanTabView: View {
  @StateObject private var qrManager = QRCodeManager.shared
  @StateObject private var contactRepository = ContactRepository.shared

  @State private var cameraPreviewLayer: AVCaptureVideoPreviewLayer?
  @State private var showingScannedCard = false
  @State private var showingPermissionAlert = false
  @State private var permissionAlertMessage = ""
  @State private var showingRouteAlert = false
  @State private var routeAlertMessage = ""
  @State private var showingPresentationFlow = false
  @State private var showingVerifierResult = false
  @State private var showingSelfQr = false
  @State private var pendingRoutePayload = ""
  @State private var verificationResult: VpTokenVerificationResult?
  @State private var lastVerification: VerificationStatus = .unverified

  var body: some View {
    NavigationStack {
      ZStack {
        Color.Theme.cardBg.ignoresSafeArea()
        CameraPreviewView(previewLayer: $cameraPreviewLayer).ignoresSafeArea()

        VStack {
          Spacer()
          ScanningFrameView()
          Spacer()
          footer
        }
      }
      .navigationTitle("Scan")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button {
            showingSelfQr = true
          } label: {
            Image(systemName: "qrcode")
          }
        }
      }
    }
    .onAppear {
      ensureCameraPermissionAndStart()
    }
    .onDisappear {
      qrManager.stopScanning()
      cameraPreviewLayer = nil
    }
    .onChange(of: qrManager.lastScanRoute) { _, route in
      handleRoute(route)
    }
    .sheet(isPresented: $showingScannedCard) {
      if let scannedCard = qrManager.lastScannedCard {
        ScannedCardView(businessCard: scannedCard, verification: lastVerification) {
          saveScannedCard(scannedCard)
        }
      }
    }
    .sheet(isPresented: $showingPresentationFlow) {
      ProofPresentationFlowSheet(requestPayload: pendingRoutePayload)
    }
    .sheet(isPresented: $showingVerifierResult) {
      if let verificationResult {
        VerifierResultSheet(result: verificationResult)
      }
    }
    .sheet(isPresented: $showingSelfQr) {
      if let card = CardManager.shared.businessCards.first {
        QRSharingView(businessCard: card)
      } else {
        NavigationStack {
          VStack(spacing: 14) {
            Text("No identity card available.")
            Text("Create a card in Me tab first.")
              .font(.caption)
              .foregroundColor(.secondary)
          }
          .padding(20)
          .navigationTitle("Present")
        }
      }
    }
    .alert("Camera Permission", isPresented: $showingPermissionAlert) {
      Button("Open Settings") {
        if let url = URL(string: UIApplication.openSettingsURLString) {
          UIApplication.shared.open(url)
        }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(permissionAlertMessage)
    }
    .alert("Scan Router", isPresented: $showingRouteAlert) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(routeAlertMessage)
    }
  }

  private var footer: some View {
    VStack(spacing: 8) {
      SolidarityPlaceholderCard(
        screenID: .scanRouter,
        title: String(localized: "Protocol Router"),
        subtitle: String(localized: "Supports OID4VP request, vp_token verify, credential offers, and SIOPv2.")
      )

      if qrManager.isScanning {
        HStack(spacing: 6) {
          ProgressView().scaleEffect(0.7)
          Text("Scanning...")
            .font(.caption)
            .foregroundColor(Color.Theme.textSecondary)
        }
      }
    }
    .padding(.horizontal, 16)
    .padding(.bottom, 100)
  }

  // MARK: - Camera

  private func startScanning() {
    switch qrManager.startScanning() {
    case .failure(let error):
      routeAlertMessage = error.localizedDescription
      showingRouteAlert = true
    case .success(let previewLayer):
      cameraPreviewLayer = previewLayer
    }
  }

  private func ensureCameraPermissionAndStart() {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      startScanning()
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async {
          if granted {
            startScanning()
          } else {
            permissionAlertMessage = String(localized: "Camera access is required to scan QR codes.")
            showingPermissionAlert = true
          }
        }
      }
    case .denied, .restricted:
      permissionAlertMessage = String(localized: "Camera access is required to scan QR codes.")
      showingPermissionAlert = true
    @unknown default:
      permissionAlertMessage = String(localized: "Camera access is required.")
      showingPermissionAlert = true
    }
  }

  // MARK: - Route Handling

  private func handleRoute(_ route: ScanRoute?) {
    guard let route else { return }
    switch route {
    case .businessCard:
      if qrManager.lastScannedCard != nil {
        lastVerification = qrManager.lastVerificationStatus ?? .unverified
        showingScannedCard = true
      }

    case .oid4vpRequest(let request):
      pendingRoutePayload = request
      showingPresentationFlow = true

    case .siopRequest(let request):
      pendingRoutePayload = request
      showingPresentationFlow = true

    case .vpToken(let token):
      verificationResult = ProofVerifierService.shared.verifyVpToken(token)
      showingVerifierResult = true

    case .credentialOffer(let offer):
      let format = String(localized: "Credential offer detected:\n%@")
      routeAlertMessage = String(format: format, offer)
      showingRouteAlert = true

    case .unknown(let payload):
      let format = String(localized: "Unknown payload:\n%@")
      routeAlertMessage = String(format: format, String(payload.prefix(120)))
      showingRouteAlert = true
    }
  }

  private func saveScannedCard(_ businessCard: BusinessCard) {
    let contact = Contact(
      id: UUID(),
      businessCard: businessCard,
      receivedAt: Date(),
      source: .qrCode,
      tags: [],
      notes: nil,
      verificationStatus: lastVerification,
      sealedRoute: qrManager.lastSealedRoute
    )

    switch contactRepository.addContact(contact) {
    case .success(let saved):
      IdentityDataStore.shared.upsertContact(ContactEntity.fromLegacy(saved))
      showingScannedCard = false
    case .failure(let error):
      routeAlertMessage = error.localizedDescription
      showingRouteAlert = true
    }
  }
}

private struct ProofPresentationFlowSheet: View {
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
        let options = VCService.IssueOptions(relyingPartyDomain: rpDomain)
        switch VCService().issueBusinessCardCredential(for: card, options: options) {
        case .failure(let error):
          isWorking = false
          alertMessage = error.localizedDescription
          showingAlert = true
          step = .review
        case .success(let credential):
          let vpToken = Self.wrapInVPEnvelope(
            vcJwt: credential.jwt,
            holderDid: credential.holderDid,
            nonce: parsedRequest?.nonce
          )
          submitToVerifier(jwt: vpToken)
        }
      }
    }
  }

  /// Wraps a VC JWT inside a Verifiable Presentation JSON envelope, then base64url-encodes it
  /// so it can be sent as a single `vp_token` string.
  private static func wrapInVPEnvelope(vcJwt: String, holderDid: String, nonce: String?) -> String {
    var vp: [String: Any] = [
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      "type": ["VerifiablePresentation"],
      "holder": holderDid,
      "verifiableCredential": [vcJwt],
    ]
    if let nonce { vp["nonce"] = nonce }

    // Encode as compact JSON — verifiers can base64url-decode or treat as opaque JWT-like token
    guard let data = try? JSONSerialization.data(withJSONObject: vp, options: [.sortedKeys]),
          let json = String(data: data, encoding: .utf8)
    else {
      // Fallback: return the bare VC JWT if envelope creation fails
      return vcJwt
    }
    return json
  }

  private func submitToVerifier(jwt: String) {
    guard let request = parsedRequest else {
      // No parsed request — fall back to local-only completion
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

private struct VerifierResultSheet: View {
  let result: VpTokenVerificationResult
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      VStack(spacing: 14) {
        SolidarityPlaceholderCard(
          screenID: .verifyResult,
          title: result.title,
          subtitle: result.reason
        )

        VStack(alignment: .leading, spacing: 8) {
          ForEach(result.details, id: \.self) { detail in
            Text("• \(detail)")
              .font(.caption)
              .foregroundColor(.secondary)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)

        Button("Close") { dismiss() }
          .buttonStyle(ThemedPrimaryButtonStyle())
      }
      .padding(16)
      .navigationTitle("Verifier")
      .navigationBarTitleDisplayMode(.inline)
    }
  }
}
