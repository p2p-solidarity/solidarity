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

  var body: some View {
    NavigationStack {
      VStack(spacing: 16) {
        switch step {
        case .review:
          SolidarityPlaceholderCard(
            screenID: .presentReview,
            title: String(localized: "Review Request"),
            subtitle: requestPayload
          )
          Button("Sign & Submit") {
            submit()
          }
          .buttonStyle(ThemedPrimaryButtonStyle())
          .disabled(isWorking)

        case .signing:
          SolidarityPlaceholderCard(
            screenID: .presentSigning,
            title: String(localized: "Signing Proof"),
            subtitle: String(localized: "Applying pairwise DID and biometric gate.")
          )
          ProgressView()

        case .submitted:
          SolidarityPlaceholderCard(
            screenID: .presentSubmit,
            title: String(localized: "Proof Submitted"),
            subtitle: String(localized: "vp_token generated and dispatched.")
          )
          Text("\(String(submittedToken.prefix(90)))...")
            .font(.caption.monospaced())
            .foregroundColor(.secondary)
          Button("Done") { dismiss() }
            .buttonStyle(ThemedPrimaryButtonStyle())
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
        let options = VCService.IssueOptions(relyingPartyDomain: extractDomain(from: requestPayload))
        switch VCService().issueBusinessCardCredential(for: card, options: options) {
        case .failure(let error):
          isWorking = false
          alertMessage = error.localizedDescription
          showingAlert = true
          step = .review
        case .success(let credential):
          isWorking = false
          submittedToken = credential.jwt
          step = .submitted
        }
      }
    }
  }

  private func extractDomain(from payload: String) -> String? {
    URL(string: payload)?.host
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
