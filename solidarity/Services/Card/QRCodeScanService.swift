import AVFoundation
import Foundation
import UIKit

final class QRCodeScanService: NSObject {
  struct ScanOutcome {
    let card: BusinessCard?
    let verificationStatus: VerificationStatus?
    let sealedRoute: String?
    let route: ScanRoute
    /// The StoredCredential.id created when a signed VC/VP was imported
    /// during this scan. Callers persisting a contact should attach this
    /// reference to ContactEntity.credentialIds via
    /// IdentityDataStore.attachCredential.
    let credentialId: UUID?

    init(
      card: BusinessCard?,
      verificationStatus: VerificationStatus?,
      sealedRoute: String?,
      route: ScanRoute,
      credentialId: UUID? = nil
    ) {
      self.card = card
      self.verificationStatus = verificationStatus
      self.sealedRoute = sealedRoute
      self.route = route
      self.credentialId = credentialId
    }
  }

  var onScanOutcome: ((Result<ScanOutcome, CardError>) -> Void)?

  let encryptionManager = EncryptionManager.shared
  let oidcService = OIDCService.shared
  let vcService = VCService()
  let proofManager = ProofGenerationManager.shared
  let identityCoordinator = IdentityCoordinator.shared
  let scanRouter = ScanRouterService.shared

  private var captureSession: AVCaptureSession?
  private var previewLayer: AVCaptureVideoPreviewLayer?
  private let scanStateLock = NSLock()
  private var isProcessingScan = false

  private let sessionQueue = DispatchQueue(label: "app.solidarity.camera.session.queue")

  // MARK: - Scanning Lifecycle

  func startScanning() -> CardResult<AVCaptureVideoPreviewLayer> {
    resetProcessingState()
    let session = AVCaptureSession()

    guard let videoCaptureDevice = AVCaptureDevice.default(for: .video) else {
      return .failure(.sharingError("No camera available"))
    }

    do {
      let videoInput = try AVCaptureDeviceInput(device: videoCaptureDevice)

      if session.canAddInput(videoInput) {
        session.addInput(videoInput)
      } else {
        return .failure(.sharingError("Unable to add camera input"))
      }

      let metadataOutput = AVCaptureMetadataOutput()

      if session.canAddOutput(metadataOutput) {
        session.addOutput(metadataOutput)
        metadataOutput.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
        metadataOutput.metadataObjectTypes = [.qr]
      } else {
        return .failure(.sharingError("Unable to add metadata output"))
      }

      let previewLayer = AVCaptureVideoPreviewLayer(session: session)
      previewLayer.videoGravity = .resizeAspectFill
      // Initial frame, will be updated by view
      previewLayer.frame = UIScreen.main.bounds

      // Stop any existing session properly before replacing
      if let existingSession = self.captureSession {
        sessionQueue.async {
          existingSession.stopRunning()
        }
      }

      self.captureSession = session
      self.previewLayer = previewLayer

      sessionQueue.async {
        session.startRunning()
      }

      return .success(previewLayer)

    } catch {
      return .failure(.sharingError("Failed to access camera: \(error.localizedDescription)"))
    }
  }

  func stopScanning() {
    guard let session = captureSession else { return }

    sessionQueue.async {
      session.stopRunning()
    }

    // Clear references immediately to avoid reusing stopped session
    captureSession = nil
    previewLayer = nil
  }

  // MARK: - Processing

  func process(scannedString data: String) {
    let route = scanRouter.route(for: data)
    switch route {
    case .oid4vpRequest(let request):
      handleOID4VPRequest(request)
      return
    case .vpToken(let token):
      handleVPToken(token)
      return
    case .credentialOffer(let offer):
      emitOutcome(.success(ScanOutcome(card: nil, verificationStatus: .pending, sealedRoute: nil, route: .credentialOffer(offer))))
      return
    case .siopRequest(let request):
      handleOIDCRequest(request, route: .siopRequest(request))
      return
    case .businessCard, .unknown:
      break
    }

    if let url = URL(string: data),
       AppBranding.isSupportedAppScheme(url.scheme),
       OIDCService.isCallbackHost(url.host) {
      handleOIDCResponse(url: url)
      return
    }

    if data.hasPrefix("openid-vc://") || data.hasPrefix("openid://") {
      handleOIDCRequest(data, route: .siopRequest(data))
      return
    }

    if AppBranding.isSupportedDeepLink(data) {
      handleDeepLink(data)
      return
    }

    // Bare JWT from didSigned QR (encoded directly without envelope wrapper).
    // JWTs have 3 base64url segments separated by dots, starting with "eyJ".
    if data.hasPrefix("eyJ"), data.split(separator: ".").count == 3 {
      let payload = QRDidSignedPayload(
        jwt: data,
        shareId: UUID(),
        expirationDate: nil,
        issuerDid: "",
        holderDid: ""
      )
      emitOutcome(handleDidSignedPayload(payload))
      return
    }

    if let envelope = decodeEnvelope(from: data) {
      handleEnvelope(envelope)
      return
    }

    handleLegacyPayload(data)
  }

  // MARK: - State Management

  func beginProcessingScanIfNeeded() -> Bool {
    scanStateLock.lock()
    defer { scanStateLock.unlock() }
    guard !isProcessingScan else { return false }
    isProcessingScan = true
    return true
  }

  func resetProcessingState() {
    scanStateLock.lock()
    isProcessingScan = false
    scanStateLock.unlock()
  }

  func emitOutcome(_ result: Result<ScanOutcome, CardError>) {
    resetProcessingState()
    onScanOutcome?(result)
  }
}

// MARK: - AVCaptureMetadataOutputObjectsDelegate

extension QRCodeScanService: AVCaptureMetadataOutputObjectsDelegate {
  func metadataOutput(
    _ output: AVCaptureMetadataOutput,
    didOutput metadataObjects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    guard beginProcessingScanIfNeeded() else { return }
    guard
      let metadataObject = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
      let value = metadataObject.stringValue
    else {
      resetProcessingState()
      return
    }

    stopScanning()
    process(scannedString: value)
  }
}

extension JSONDecoder {
  static var qrDecoder: JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return decoder
  }
}
