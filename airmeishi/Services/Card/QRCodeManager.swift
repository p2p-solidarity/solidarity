import Foundation
import AVFoundation
import UIKit

final class QRCodeManager: ObservableObject {
    static let shared = QRCodeManager()
    
    @Published var isScanning = false
    @Published var isGenerating = false
    @Published var lastScannedCard: BusinessCard?
    @Published var lastVerificationStatus: VerificationStatus?
    @Published var lastSealedRoute: String?
    @Published var scanError: CardError?
    
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
        generationService.generateImage(from: string)
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
                let baseURL = "https://airmeishi.app/share"
                return .success("\(baseURL)/\(envelope.shareId.uuidString)")
            } catch {
                return .failure(.sharingError("Failed to persist share payload"))
            }
        }
    }

    // MARK: - Scanning

    func startScanning() -> CardResult<AVCaptureVideoPreviewLayer> {
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
                self.scanError = nil
            case .failure(let error):
                self.scanError = error
            }
        }
    }
}
