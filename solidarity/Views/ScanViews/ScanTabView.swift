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
  @State private var showingCredentialImport = false
  @State private var pendingCredentialOffer = ""
  @State private var pendingRoutePayload = ""
  @State private var verificationResult: VpTokenVerificationResult?
  @State private var lastVerification: VerificationStatus = .unverified
  @State private var showingMergeConfirmation = false

  var body: some View {
    NavigationStack {
      ZStack {
        Color.Theme.pageBg.ignoresSafeArea()
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
    .onReceive(qrManager.$scanError) { error in
      guard let error else { return }
      routeAlertMessage = error.localizedDescription
      showingRouteAlert = true
    }
    .onReceive(contactRepository.$pendingMergeProposal) { proposal in
      showingMergeConfirmation = proposal != nil
    }
    .sheet(isPresented: $showingScannedCard, onDismiss: restartScanningIfPossible) {
      if let scannedCard = qrManager.lastScannedCard {
        ScannedCardView(businessCard: scannedCard, verification: lastVerification) {
          saveScannedCard(scannedCard)
        }
      }
    }
    .sheet(isPresented: $showingPresentationFlow, onDismiss: restartScanningIfPossible) {
      ProofPresentationFlowSheet(requestPayload: pendingRoutePayload)
    }
    .sheet(isPresented: $showingVerifierResult, onDismiss: restartScanningIfPossible) {
      if let verificationResult {
        VerifierResultSheet(result: verificationResult)
      }
    }
    .sheet(isPresented: $showingCredentialImport, onDismiss: restartScanningIfPossible) {
      CredentialImportFlowSheet(offerURL: pendingCredentialOffer)
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
    .confirmationDialog(
      "Merge Contact",
      isPresented: $showingMergeConfirmation,
      titleVisibility: .visible
    ) {
      Button("Merge", role: .none) {
        switch contactRepository.resolvePendingMerge(accept: true) {
        case .success(let merged):
          if let merged {
            IdentityDataStore.shared.upsertContact(ContactEntity.fromLegacy(merged))
            if let credentialId = qrManager.lastCredentialId {
              IdentityDataStore.shared.attachCredential(
                contactID: merged.id.uuidString,
                credentialID: credentialId.uuidString
              )
            }
            ToastManager.shared.show(
              title: String(localized: "Contact Updated"),
              message: String(localized: "Merged and saved to People."),
              type: .success
            )
          }
        case .failure(let error):
          routeAlertMessage = error.localizedDescription
          showingRouteAlert = true
        }
      }
      Button("Keep Existing", role: .cancel) {
        _ = contactRepository.resolvePendingMerge(accept: false)
      }
    } message: {
      if let proposal = contactRepository.pendingMergeProposal {
        Text("A contact for \(proposal.existing.businessCard.name) already exists. Merge with the newly scanned card?")
      } else {
        Text("A duplicate contact was detected. Merge confirmation is required.")
      }
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
        if lastVerification == .verified {
          ToastManager.shared.show(
            title: String(localized: "Verification Success"),
            message: String(localized: "Credential verified. Save to add to People."),
            type: .success,
            duration: 2.2
          )
        }
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
      pendingCredentialOffer = offer
      showingCredentialImport = true

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
      if let credentialId = qrManager.lastCredentialId {
        IdentityDataStore.shared.attachCredential(
          contactID: saved.id.uuidString,
          credentialID: credentialId.uuidString
        )
      }
      showingScannedCard = false
      ToastManager.shared.show(
        title: String(localized: "Saved to People"),
        message: String(localized: "Contact saved successfully."),
        type: .success
      )
    case .failure(let error):
      if isMergeConfirmationRequired(error) {
        showingMergeConfirmation = true
      } else {
        routeAlertMessage = error.localizedDescription
        showingRouteAlert = true
      }
    }
  }

  private func isMergeConfirmationRequired(_ error: CardError) -> Bool {
    if case .validationError(let message) = error {
      return message.contains("Merge confirmation required")
    }
    return false
  }

  private func restartScanningIfPossible() {
    guard !qrManager.isScanning else { return }
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else { return }
    startScanning()
  }
}
