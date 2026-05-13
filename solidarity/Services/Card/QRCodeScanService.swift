import AVFoundation
import Foundation
import UIKit

enum QRCodeScanDisposition: Equatable {
  case handled
  case awaitingMoreChunks
}

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
    /// Proof-claim labels (e.g. "is_human", "age_over_18") declared in the
    /// peer's VC `verified_proofs.claims` block. Only ever non-nil when the
    /// underlying issuer signature verified successfully — handlers gate
    /// extraction on verification status so a forged JWT cannot leak
    /// untrusted claims downstream. nil means either the scan path did not
    /// parse a claims field (plaintext / non-VC route) OR verification
    /// failed; empty array means the peer's VC explicitly declared zero
    /// proofs. REPLACE-when-non-nil semantics — callers should leave
    /// existing ContactEntity.declaredProofClaims untouched when this is nil.
    let declaredProofClaims: [String]?

    init(
      card: BusinessCard?,
      verificationStatus: VerificationStatus?,
      sealedRoute: String?,
      route: ScanRoute,
      credentialId: UUID? = nil,
      declaredProofClaims: [String]? = nil
    ) {
      self.card = card
      self.verificationStatus = verificationStatus
      self.sealedRoute = sealedRoute
      self.route = route
      self.credentialId = credentialId
      self.declaredProofClaims = declaredProofClaims
    }
  }

  var onScanOutcome: ((Result<ScanOutcome, CardError>) -> Void)?
  var onChunkProgress: ((QRCodeChunkProgress) -> Void)?

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
  private let chunkReassembler = QRCodeChunkReassembler()

  private let sessionQueue = DispatchQueue(label: "app.solidarity.camera.session.queue")

  // MARK: - Scanning Lifecycle

  func startScanning() -> CardResult<AVCaptureVideoPreviewLayer> {
    resetProcessingState()
    chunkReassembler.reset()
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

  /// Upper bound on a decoded payload after optional chunk reassembly.
  /// Single physical QR symbols remain far smaller, but chunked proof
  /// transfer needs enough room for offline VP payloads while still bounding
  /// memory for adversarial input.
  static let maxQRPayloadBytes = QRCodeChunkingService.maxReassembledPayloadBytes

  @discardableResult
  func process(scannedString data: String) -> QRCodeScanDisposition {
    if QRCodeChunkingService.isChunkFrame(data) {
      return processChunkFrame(data)
    }
    return processResolvedPayload(data)
  }

  private func processChunkFrame(_ data: String) -> QRCodeScanDisposition {
    do {
      switch try chunkReassembler.ingest(data) {
      case .progress(let progress):
        onChunkProgress?(progress)
        return .awaitingMoreChunks
      case .complete(let payload, let progress):
        onChunkProgress?(progress)
        return processResolvedPayload(payload)
      }
    } catch {
      chunkReassembler.reset()
      emitOutcome(.failure(.sharingError("Invalid chunked QR payload")))
      return .handled
    }
  }

  private func processResolvedPayload(_ data: String) -> QRCodeScanDisposition {
    guard data.utf8.count <= Self.maxQRPayloadBytes else {
      emitOutcome(.failure(.sharingError("QR payload exceeds size limit")))
      return .handled
    }

    let route = scanRouter.route(for: data)
    switch route {
    case .oid4vpRequest(let request):
      handleOID4VPRequest(request)
      return .handled
    case .vpToken(let token):
      handleVPToken(token)
      return .handled
    case .credentialOffer(let offer):
      emitOutcome(.success(ScanOutcome(card: nil, verificationStatus: .pending, sealedRoute: nil, route: .credentialOffer(offer))))
      return .handled
    case .siopRequest(let request):
      handleOIDCRequest(request, route: .siopRequest(request))
      return .handled
    case .businessCard, .unknown:
      break
    }

    if let token = decodePresentationToken(from: data) {
      handleVPToken(token)
      return .handled
    }

    if let url = URL(string: data),
       AppBranding.isSupportedAppScheme(url.scheme),
       OIDCService.isCallbackHost(url.host) {
      handleOIDCResponse(url: url)
      return .handled
    }

    if data.hasPrefix("openid-vc://") || data.hasPrefix("openid://") {
      handleOIDCRequest(data, route: .siopRequest(data))
      return .handled
    }

    if AppBranding.isSupportedDeepLink(data) {
      handleDeepLink(data)
      return .handled
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
      return .handled
    }

    if let envelope = decodeEnvelope(from: data) {
      handleEnvelope(envelope)
      return .handled
    }

    handleLegacyPayload(data)
    return .handled
  }

  private func decodePresentationToken(from data: String) -> String? {
    let token: String
    if let decompressed = QRCodeGenerationService.decompressQR(data),
       let decompressedString = String(data: decompressed, encoding: .utf8) {
      token = decompressedString
    } else {
      token = data
    }

    guard
      let jsonData = token.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any]
    else {
      return nil
    }

    if let types = json["type"] as? [String], types.contains("VerifiablePresentation") {
      return token
    }
    if json["semaphore_proof"] != nil || json["proof_type"] != nil {
      return token
    }
    return nil
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
    chunkReassembler.reset()
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

    switch process(scannedString: value) {
    case .handled:
      stopScanning()
    case .awaitingMoreChunks:
      resetProcessingState()
    }
  }
}

extension JSONDecoder {
  static var qrDecoder: JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return decoder
  }
}
