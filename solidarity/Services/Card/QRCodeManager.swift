import AVFoundation
import Foundation
import UIKit

final class QRCodeManager: ObservableObject {
  static let shared = QRCodeManager()

  @Published var isScanning = false
  @Published var isGenerating = false
  @Published var lastScannedCard: BusinessCard?
  @Published var lastVerificationStatus: VerificationStatus?
  @Published var lastSealedRoute: String?
  @Published var lastScanRoute: ScanRoute?
  @Published var scanError: CardError?
  /// StoredCredential.id for the VC imported during the last scan, if any.
  /// Used by contact-save flows to attach the credential reference.
  @Published var lastCredentialId: UUID?

  private let generationService: QRCodeGenerationService
  private let scanService: QRCodeScanService

  private init(
    generationService: QRCodeGenerationService = QRCodeGenerationService(),
    scanService: QRCodeScanService = QRCodeScanService()
  ) {
    self.generationService = generationService
    self.scanService = scanService

    self.scanService.onScanOutcome = { [weak self] result in
      self?.handleScanResult(result)
    }
  }

  // MARK: - Generation

  func generateQRCode(from string: String) -> CardResult<UIImage> {
    // Try descending correction levels: H → M → L.
    // VP / VC payloads often exceed "H" capacity (~1273 bytes).
    for level in ["H", "M", "L"] {
      if case .success(let image) = generationService.generateImage(from: string, correctionLevel: level) {
        return .success(image)
      }
    }
    return generationService.generateImage(from: string, correctionLevel: "L")
  }

  func generateQRCode(
    for businessCard: BusinessCard,
    fields: Set<BusinessCardField>,
    expirationDate: Date? = nil
  ) -> CardResult<UIImage> {
    isGenerating = true
    let result = generationService.generateImage(
      for: businessCard,
      fields: fields,
      expirationDate: expirationDate
    )
    isGenerating = false
    return result
  }

  func generateQRCode(
    for businessCard: BusinessCard,
    sharingLevel: SharingLevel,
    expirationDate: Date? = nil
  ) -> CardResult<UIImage> {
    isGenerating = true
    let result = generationService.generateImage(
      for: businessCard,
      sharingLevel: sharingLevel,
      expirationDate: expirationDate
    )
    isGenerating = false
    return result
  }

  func generateSharingLink(
    for businessCard: BusinessCard,
    sharingLevel: SharingLevel,
    maxUses: Int = 1
  ) -> CardResult<String> {
    switch generationService.buildEnvelope(for: businessCard, sharingLevel: sharingLevel) {
    case .failure(let error):
      return .failure(error)
    case .success(let envelope):
      do {
        let data = try JSONEncoder.qrEncoder.encode(envelope)
        let key = "sharing_\(envelope.shareId.uuidString)"
        UserDefaults.standard.set(data, forKey: key)
        let baseURL = AppBranding.currentShareBaseURL
        return .success("\(baseURL)/\(envelope.shareId.uuidString)")
      } catch {
        return .failure(.sharingError("Failed to persist share payload"))
      }
    }
  }

  // MARK: - Scanning

  func startScanning() -> CardResult<AVCaptureVideoPreviewLayer> {
    // Reset route so scanning the same payload again still emits a route change.
    lastScanRoute = nil
    scanError = nil
    let result = scanService.startScanning()
    if case .success = result {
      isScanning = true
    }
    return result
  }

  func stopScanning() {
    isScanning = false
    scanService.stopScanning()
  }

  func processScannedData(_ data: String) {
    scanService.process(scannedString: data)
  }

  // MARK: - Private

  private func handleScanResult(_ result: Result<QRCodeScanService.ScanOutcome, CardError>) {
    DispatchQueue.main.async {
      self.isScanning = false
      switch result {
      case .success(let outcome):
        self.lastScannedCard = outcome.card
        self.lastVerificationStatus = outcome.verificationStatus
        self.lastSealedRoute = outcome.sealedRoute
        self.lastCredentialId = outcome.credentialId
        self.lastScanRoute = nil
        self.lastScanRoute = outcome.route
        self.scanError = nil
      case .failure(let error):
        self.lastScanRoute = nil
        self.scanError = error
      }
    }
  }
}
