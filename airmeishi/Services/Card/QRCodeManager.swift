//
//  QRCodeManager.swift
//  airmeishi
//
//  QR code generation and scanning service with encrypted sharing and privacy controls
//

import Foundation
import CoreImage
import AVFoundation
import UIKit
import CryptoKit

/// Manages QR code generation and scanning with encrypted sharing capabilities
class QRCodeManager: NSObject, ObservableObject {
    static let shared = QRCodeManager()
    
    @Published var isScanning = false
    @Published var isGenerating = false
    @Published var lastScannedCard: BusinessCard?
    @Published var lastVerificationStatus: VerificationStatus?
    @Published var scanError: CardError?
    
    private let encryptionManager = EncryptionManager.shared
    private var captureSession: AVCaptureSession?
    private var previewLayer: AVCaptureVideoPreviewLayer?
    
    private override init() {
        super.init()
    }
    
    // MARK: - QR Code Generation
    
    /// Public helper: generate a QR code image for arbitrary string content
    func generateQRCode(from string: String) -> CardResult<UIImage> {
        return generateQRCodeImage(from: string)
    }

    /// Generate QR code for business card with selective field disclosure
    func generateQRCode(
        for businessCard: BusinessCard,
        sharingLevel: SharingLevel,
        expirationDate: Date? = nil
    ) -> CardResult<UIImage> {
        isGenerating = true
        defer { isGenerating = false }
        
        // Create filtered card based on sharing level
        let filteredCard = businessCard.filteredCard(for: sharingLevel)
        
        // Optional: generate selective disclosure proof when enabled
        var sdProof: SelectiveDisclosureProof? = nil
        if businessCard.sharingPreferences.useZK {
            let allowed = businessCard.sharingPreferences.fieldsForLevel(sharingLevel)
            let sdResult = ProofGenerationManager.shared.generateSelectiveDisclosureProof(
                businessCard: businessCard,
                selectedFields: allowed,
                recipientId: nil
            )
            if case .success(let proof) = sdResult { sdProof = proof }
        }
        
        // Load or create issuer identity commitment and optional proof
        let identityBundle = SemaphoreIdentityManager.shared.getIdentity() ?? (try? SemaphoreIdentityManager.shared.loadOrCreateIdentity())
        let issuerCommitment = identityBundle?.commitment ?? ""
        var issuerProof: String? = nil
        if !issuerCommitment.isEmpty {
            // Bind proof to this share instance via shareId; compute after creating shareId
        }
        
        // Create sharing payload
        let shareUUID = UUID()
        if !issuerCommitment.isEmpty {
            // Try to generate a Semaphore proof if supported; ignore errors in fallback
            if SemaphoreIdentityManager.proofsSupported {
                issuerProof = (try? SemaphoreIdentityManager.shared.generateProof(
                    groupCommitments: [issuerCommitment],
                    message: shareUUID.uuidString,
                    scope: sharingLevel.rawValue
                ))
            }
        }
        let sharingPayload = QRSharingPayload(
            businessCard: filteredCard,
            sharingLevel: sharingLevel,
            expirationDate: expirationDate ?? Date().addingTimeInterval(24 * 60 * 60), // 24 hours default
            shareId: shareUUID,
            createdAt: Date(),
            issuerCommitment: issuerCommitment.isEmpty ? nil : issuerCommitment,
            issuerProof: issuerProof,
            sdProof: sdProof
        )
        
        // Encrypt the payload
        let encryptionResult = encryptionManager.encrypt(sharingPayload)
        
        switch encryptionResult {
        case .success(let encryptedData):
            // Convert to base64 for QR code
            let base64String = encryptedData.base64EncodedString()
            
            // Generate QR code image
            return generateQRCodeImage(from: base64String)
            
        case .failure(let error):
            return .failure(error)
        }
    }
    
    /// Generate one-time sharing link with rate limiting
    func generateSharingLink(
        for businessCard: BusinessCard,
        sharingLevel: SharingLevel,
        maxUses: Int = 1
    ) -> CardResult<String> {
        let shareId = UUID()
        let expirationDate = Date().addingTimeInterval(60 * 60) // 1 hour
        
        let sharingPayload = QRSharingPayload(
            businessCard: businessCard.filteredCard(for: sharingLevel),
            sharingLevel: sharingLevel,
            expirationDate: expirationDate,
            shareId: shareId,
            createdAt: Date(),
            maxUses: maxUses,
            currentUses: 0
        )
        
        // Store the sharing payload for later retrieval
        let storeResult = storeSharingPayload(sharingPayload)
        
        switch storeResult {
        case .success:
            // Create sharing URL
            let baseURL = "https://airmeishi.app/share" // This would be your actual domain
            let shareURL = "\(baseURL)/\(shareId.uuidString)"
            return .success(shareURL)
            
        case .failure(let error):
            return .failure(error)
        }
    }
    
    // MARK: - QR Code Scanning
    
    /// Start QR code scanning session
    func startScanning() -> CardResult<AVCaptureVideoPreviewLayer> {
        guard !isScanning else {
            return .failure(.sharingError("Scanning already in progress"))
        }
        
        // Request camera permission
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            break
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    if granted {
                        _ = self.setupCaptureSession()
                    } else {
                        self.scanError = .sharingError("Camera access denied")
                    }
                }
            }
            return .failure(.sharingError("Camera permission required"))
        case .denied, .restricted:
            return .failure(.sharingError("Camera access denied"))
        @unknown default:
            return .failure(.sharingError("Unknown camera permission status"))
        }
        
        return setupCaptureSession()
    }
    
    /// Stop QR code scanning session
    func stopScanning() {
        isScanning = false
        captureSession?.stopRunning()
        captureSession = nil
        previewLayer = nil
    }
    
    /// Process scanned QR code data
    func processScannedData(_ data: String) {
        // Check if this is an airmeishi:// URL scheme
        if data.hasPrefix("airmeishi://") {
            // Handle via DeepLinkManager
            let handled = DeepLinkManager.shared.handleQRCodeScan(data)
            if handled {
                // DeepLinkManager will handle card creation
                // We need to wait for it to complete and then set our state
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    if let receivedCard = DeepLinkManager.shared.lastReceivedCard {
                        self.lastScannedCard = receivedCard
                        self.lastVerificationStatus = .unverified
                        self.scanError = nil
                    }
                }
            } else {
                DispatchQueue.main.async {
                    self.scanError = .sharingError("Invalid airmeishi:// URL format")
                }
            }
            return
        }

        // Try to decode as base64 encrypted data
        guard let encryptedData = Data(base64Encoded: data) else {
            scanError = .sharingError("Invalid QR code format")
            return
        }

        // Decrypt the payload
        let decryptionResult = encryptionManager.decrypt(encryptedData, as: QRSharingPayload.self)

        switch decryptionResult {
        case .success(let payload):
            // Check expiration
            if payload.expirationDate < Date() {
                scanError = .sharingError("Shared card has expired")
                return
            }

            // Check usage limits
            if let maxUses = payload.maxUses,
               let currentUses = payload.currentUses,
               currentUses >= maxUses {
                scanError = .sharingError("Share link has reached maximum uses")
                return
            }

            // Verify issuer commitment / proof if present
            let status = verifyIssuer(commitment: payload.issuerCommitment, proof: payload.issuerProof, message: payload.shareId.uuidString, scope: payload.sharingLevel.rawValue)
            DispatchQueue.main.async {
                self.lastVerificationStatus = status
            }

            // Optionally verify selective disclosure proof if included
            if let proof = payload.sdProof {
                let vr = ProofGenerationManager.shared.verifySelectiveDisclosureProof(proof, expectedBusinessCardId: payload.businessCard.id.uuidString)
                if case .success(let res) = vr, !res.isValid {
                    // downgrade status if SD proof invalid
                    DispatchQueue.main.async { self.lastVerificationStatus = .failed }
                }
            }

            // Successfully decoded business card
            DispatchQueue.main.async {
                self.lastScannedCard = payload.businessCard
                self.scanError = nil
            }

        case .failure(let error):
            scanError = error
        }
    }
    
    // MARK: - Private Methods
    
    /// Generate QR code image from string data
    private func generateQRCodeImage(from string: String) -> CardResult<UIImage> {
        guard let data = string.data(using: .utf8) else {
            return .failure(.sharingError("Failed to convert string to data"))
        }
        
        guard let filter = CIFilter(name: "CIQRCodeGenerator") else {
            return .failure(.sharingError("QR code generator not available"))
        }
        
        filter.setValue(data, forKey: "inputMessage")
        filter.setValue("H", forKey: "inputCorrectionLevel") // High error correction
        
        guard let ciImage = filter.outputImage else {
            return .failure(.sharingError("Failed to generate QR code (beta not supported yet)"))
        }
        
        // Scale up the image for better quality
        let transform = CGAffineTransform(scaleX: 10, y: 10)
        let scaledImage = ciImage.transformed(by: transform)
        
        let context = CIContext()
        guard let cgImage = context.createCGImage(scaledImage, from: scaledImage.extent) else {
            return .failure(.sharingError("Failed to create QR code image"))
        }
        
        let uiImage = UIImage(cgImage: cgImage)
        return .success(uiImage)
    }
    
    /// Setup camera capture session for QR scanning
    private func setupCaptureSession() -> CardResult<AVCaptureVideoPreviewLayer> {
        let session = AVCaptureSession()
        
        guard let videoCaptureDevice = AVCaptureDevice.default(for: .video) else {
            return .failure(.sharingError("No camera available"))
        }
        
        do {
            let videoInput = try AVCaptureDeviceInput(device: videoCaptureDevice)
            
            if session.canAddInput(videoInput) {
                session.addInput(videoInput)
            } else {
                return .failure(.sharingError("Could not add video input"))
            }
            
            let metadataOutput = AVCaptureMetadataOutput()
            
            if session.canAddOutput(metadataOutput) {
                session.addOutput(metadataOutput)
                
                metadataOutput.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
                metadataOutput.metadataObjectTypes = [.qr]
            } else {
                return .failure(.sharingError("Could not add metadata output"))
            }
            
            let previewLayer = AVCaptureVideoPreviewLayer(session: session)
            previewLayer.videoGravity = .resizeAspectFill
            
            self.captureSession = session
            self.previewLayer = previewLayer
            
            DispatchQueue.global(qos: .userInitiated).async {
                session.startRunning()
                DispatchQueue.main.async {
                    self.isScanning = true
                }
            }
            
            return .success(previewLayer)
            
        } catch {
            return .failure(.sharingError("Failed to setup camera: \(error.localizedDescription)"))
        }
    }
    
    /// Store sharing payload for link-based sharing
    private func storeSharingPayload(_ payload: QRSharingPayload) -> CardResult<Void> {
        // In a real implementation, this would store to a server or local cache
        // For now, we'll use UserDefaults as a simple storage mechanism
        let encoder = JSONEncoder()
        
        do {
            let data = try encoder.encode(payload)
            UserDefaults.standard.set(data, forKey: "sharing_\(payload.shareId.uuidString)")
            return .success(())
        } catch {
            return .failure(.storageError("Failed to store sharing payload: \(error.localizedDescription)"))
        }
    }
    
    /// Validate issuer commitment and optional proof
    private func verifyIssuer(commitment: String?, proof: String?, message: String, scope: String) -> VerificationStatus {
        guard let commitment = commitment, !commitment.isEmpty else {
            return .failed
        }
        // Basic hex validation
        let hexSet = CharacterSet(charactersIn: "0123456789abcdefABCDEF")
        let isHex = commitment.unicodeScalars.allSatisfy { hexSet.contains($0) }
        if !isHex || commitment.count < 32 {
            return .failed
        }
        // If we have a proof and library is available, verify
        if let proof = proof, SemaphoreIdentityManager.proofsSupported {
            let ok = (try? SemaphoreIdentityManager.shared.verifyProof(proof)) ?? false
            return ok ? .verified : .failed
        }
        // Without a proof, mark as pending but acceptable commitment
        return .pending
    }
}

// MARK: - AVCaptureMetadataOutputObjectsDelegate

extension QRCodeManager: AVCaptureMetadataOutputObjectsDelegate {
    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        if let metadataObject = metadataObjects.first {
            guard let readableObject = metadataObject as? AVMetadataMachineReadableCodeObject else { return }
            guard let stringValue = readableObject.stringValue else { return }
            
            // Process the scanned data
            processScannedData(stringValue)
            
            // Stop scanning after successful scan
            stopScanning()
        }
    }
}

// MARK: - Supporting Models

/// Payload structure for QR code sharing with encryption
struct QRSharingPayload: Codable {
    let businessCard: BusinessCard
    let sharingLevel: SharingLevel
    let expirationDate: Date
    let shareId: UUID
    let createdAt: Date
    let maxUses: Int?
    let currentUses: Int?
    let issuerCommitment: String?
    let issuerProof: String?
    let sdProof: SelectiveDisclosureProof?
    
    init(
        businessCard: BusinessCard,
        sharingLevel: SharingLevel,
        expirationDate: Date,
        shareId: UUID,
        createdAt: Date,
        maxUses: Int? = nil,
        currentUses: Int? = nil,
        issuerCommitment: String? = nil,
        issuerProof: String? = nil,
        sdProof: SelectiveDisclosureProof? = nil
    ) {
        self.businessCard = businessCard
        self.sharingLevel = sharingLevel
        self.expirationDate = expirationDate
        self.shareId = shareId
        self.createdAt = createdAt
        self.maxUses = maxUses
        self.currentUses = currentUses
        self.issuerCommitment = issuerCommitment
        self.issuerProof = issuerProof
        self.sdProof = sdProof
    }
}