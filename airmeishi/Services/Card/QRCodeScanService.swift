import Foundation
import AVFoundation
import UIKit

final class QRCodeScanService: NSObject {
    struct ScanOutcome {
        let card: BusinessCard?
        let verificationStatus: VerificationStatus?
        let sealedRoute: String?
    }

    var onScanOutcome: ((Result<ScanOutcome, CardError>) -> Void)?

    private let encryptionManager = EncryptionManager.shared
    private let oidcService = OIDCService.shared
    private let vcService = VCService()
    private let proofManager = ProofGenerationManager.shared
    private let identityCoordinator = IdentityCoordinator.shared

    private var captureSession: AVCaptureSession?
    private var previewLayer: AVCaptureVideoPreviewLayer?

    private let sessionQueue = DispatchQueue(label: "app.airmeishi.camera.session.queue")

    // MARK: - Scanning Lifecycle

    func startScanning() -> CardResult<AVCaptureVideoPreviewLayer> {
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
        if let url = URL(string: data), url.scheme == "airmeishi", url.host == "oidc" {
            handleOIDCResponse(url: url)
            return
        }

        if data.hasPrefix("openid-vc://") || data.hasPrefix("openid://") {
            handleOIDCRequest(data)
            return
        }

        if data.hasPrefix("airmeishi://") {
            handleDeepLink(data)
            return
        }

        if let envelope = decodeEnvelope(from: data) {
            handleEnvelope(envelope)
            return
        }

        handleLegacyPayload(data)
    }

    // MARK: - Envelope Handling

    private func decodeEnvelope(from string: String) -> QRCodeEnvelope? {
        guard let data = string.data(using: .utf8) else { return nil }
        return try? JSONDecoder.qrDecoder.decode(QRCodeEnvelope.self, from: data)
    }

    private func handleEnvelope(_ envelope: QRCodeEnvelope) {
        switch envelope.format {
        case .plaintext:
            guard let payload = envelope.plaintext else {
                onScanOutcome?(.failure(.sharingError("Missing plaintext payload")))
                return
            }
            if let expiration = payload.expirationDate, expiration < Date() {
                onScanOutcome?(.failure(.sharingError("Shared card has expired")))
                return
            }
            let card = rebuildCard(from: payload)
            // Extract sealed route from snapshot if available
            let sealedRoute = payload.snapshot.sealedRoute
            
            identityCoordinator.updateVerificationStatus(for: card.id, status: .unverified)
            onScanOutcome?(.success(ScanOutcome(
                card: card, 
                verificationStatus: .unverified,
                sealedRoute: sealedRoute
            )))

        case .zkProof:
            guard let base64 = envelope.encryptedPayload else {
                onScanOutcome?(.failure(.sharingError("Missing encrypted payload")))
                return
            }
            let result = handleEncryptedPayload(base64)
            onScanOutcome?(result)

        case .didSigned:
            guard let payload = envelope.didSigned else {
                onScanOutcome?(.failure(.sharingError("Missing DID payload")))
                return
            }
            if let expiration = payload.expirationDate, expiration < Date() {
                onScanOutcome?(.failure(.sharingError("Shared card has expired")))
                return
            }
            let result = handleDidSignedPayload(payload)
            onScanOutcome?(result)
        }
    }

    private func handleEncryptedPayload(_ base64: String) -> Result<ScanOutcome, CardError> {
        guard let data = Data(base64Encoded: base64) else {
            return .failure(.sharingError("Invalid encrypted payload"))
        }

        let decrypted = encryptionManager.decrypt(data, as: QRSharingPayload.self)

        switch decrypted {
        case .failure(let error):
            return .failure(error)
        case .success(let payload):
            return evaluateSharingPayload(payload)
        }
    }

    private func evaluateSharingPayload(_ payload: QRSharingPayload) -> Result<ScanOutcome, CardError> {
        if payload.expirationDate < Date() {
            return .failure(.sharingError("Shared card has expired"))
        }

        if let maxUses = payload.maxUses,
           let currentUses = payload.currentUses,
           currentUses >= maxUses {
            return .failure(.sharingError("Share link has reached maximum uses"))
        }

        let status = verifyIssuer(
            commitment: payload.issuerCommitment,
            proof: payload.issuerProof,
            message: payload.shareId.uuidString,
            scope: payload.sharingLevel.rawValue
        )

        if let proof = payload.sdProof {
            let verification = proofManager.verifySelectiveDisclosureProof(
                proof,
                expectedBusinessCardId: payload.businessCard.id.uuidString
            )
            if case .success(let outcome) = verification, outcome.isValid == false {
                return .success(ScanOutcome(
                    card: payload.businessCard,
                    verificationStatus: .failed,
                    sealedRoute: payload.sealedRoute
                ))
            }
        }

        identityCoordinator.updateVerificationStatus(for: payload.businessCard.id, status: status)
        return .success(ScanOutcome(
            card: payload.businessCard,
            verificationStatus: status,
            sealedRoute: payload.sealedRoute
        ))
    }

    private func handleDidSignedPayload(_ payload: QRDidSignedPayload) -> Result<ScanOutcome, CardError> {
        switch vcService.importPresentedCredential(jwt: payload.jwt) {
        case .failure(let error):
            return .failure(error)
        case .success(let imported):
            let verificationResult = vcService.verifyStoredCredential(imported.storedCredential)
            let status: VerificationStatus
            switch verificationResult {
            case .success(let updated):
                status = statusFromStoredCredential(updated.status)
            case .failure:
                status = .unverified
            }
            identityCoordinator.updateVerificationStatus(for: imported.businessCard.id, status: status)
            return .success(ScanOutcome(card: imported.businessCard, verificationStatus: status, sealedRoute: nil))
        }
    }

    private func handleLegacyPayload(_ data: String) {
        guard let encryptedData = Data(base64Encoded: data) else {
            onScanOutcome?(.failure(.sharingError("Invalid QR code format")))
            return
        }

        let decryptionResult = encryptionManager.decrypt(encryptedData, as: QRSharingPayload.self)
        switch decryptionResult {
        case .failure(let error):
            onScanOutcome?(.failure(error))
        case .success(let payload):
            identityCoordinator.updateVerificationStatus(for: payload.businessCard.id, status: .unverified)
            onScanOutcome?(evaluateSharingPayload(payload))
        }
    }

    // MARK: - OIDC Handlers

    private func handleOIDCRequest(_ data: String) {
        switch oidcService.parseRequest(from: data) {
        case .failure(let error):
            onScanOutcome?(.failure(error))
        case .success(let request):
            guard let businessCard = CardManager.shared.businessCards.first else {
                onScanOutcome?(.failure(.notFound("No business card available to present.")))
                return
            }

            switch vcService.issueBusinessCardCredential(for: businessCard) {
            case .failure(let error):
                onScanOutcome?(.failure(error))
            case .success(let credential):
                switch oidcService.buildResponseURL(for: request, vpToken: credential.jwt) {
                case .failure(let error):
                    onScanOutcome?(.failure(error))
                case .success(let url):
                    DispatchQueue.main.async {
                        UIApplication.shared.open(url, options: [:], completionHandler: nil)
                    }
                    onScanOutcome?(.success(ScanOutcome(card: businessCard, verificationStatus: .pending, sealedRoute: nil)))
                }
            }
        }
    }

    private func handleOIDCResponse(url: URL) {
        switch oidcService.handleResponse(url: url, vcService: vcService) {
        case .failure(let error):
            onScanOutcome?(.failure(error))
        case .success(let imported):
            let verificationOutcome = vcService.verifyStoredCredential(imported.storedCredential)
            let status: VerificationStatus
            switch verificationOutcome {
            case .success(let updated):
                status = statusFromStoredCredential(updated.status)
            case .failure:
                status = .unverified
            }
            identityCoordinator.updateVerificationStatus(for: imported.businessCard.id, status: status)
            onScanOutcome?(.success(ScanOutcome(card: imported.businessCard, verificationStatus: status, sealedRoute: nil)))
        }
    }

    private func handleDeepLink(_ data: String) {
        let handled = DeepLinkManager.shared.handleQRCodeScan(data)
        if handled {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                if let card = DeepLinkManager.shared.lastReceivedCard {
                    self.onScanOutcome?(.success(ScanOutcome(card: card, verificationStatus: .unverified, sealedRoute: nil)))
                } else {
                    self.onScanOutcome?(.failure(.sharingError("No card received from deep link")))
                }
            }
        } else {
            onScanOutcome?(.failure(.sharingError("Invalid airmeishi:// URL format")))
        }
    }

    // MARK: - Helpers

    private func rebuildCard(from payload: QRPlaintextPayload) -> BusinessCard {
        let snapshot = payload.snapshot
        let skills = snapshot.skills.map {
            Skill(
                name: $0.name,
                category: $0.category,
                proficiencyLevel: ProficiencyLevel(rawValue: $0.proficiency) ?? .intermediate
            )
        }

        let networks = snapshot.socialProfiles.map {
            SocialNetwork(
                platform: SocialPlatform(rawValue: $0.platform) ?? .other,
                username: $0.username,
                url: $0.url
            )
        }

        let animal = snapshot.animal.flatMap { AnimalCharacter(rawValue: $0.id) }

        return BusinessCard(
            id: snapshot.cardId,
            name: snapshot.name,
            title: snapshot.title,
            company: snapshot.company,
            email: snapshot.emails.first,
            phone: snapshot.phones.first,
            profileImage: snapshot.profileImageDataURI.flatMap { Data(dataURI: $0) },
            animal: animal,
            socialNetworks: networks,
            skills: skills,
            categories: snapshot.categories,
            sharingPreferences: SharingPreferences()
        )
    }

    private func verifyIssuer(
        commitment: String?,
        proof: String?,
        message: String,
        scope: String
    ) -> VerificationStatus {
        guard let commitment = commitment, !commitment.isEmpty else {
            return .failed
        }

        let hexSet = CharacterSet(charactersIn: "0123456789abcdefABCDEF")
        let isHex = commitment.unicodeScalars.allSatisfy { hexSet.contains($0) }
        if !isHex || commitment.count < 32 {
            return .failed
        }

        if let proof = proof, SemaphoreIdentityManager.proofsSupported {
            let ok = (try? SemaphoreIdentityManager.shared.verifyProof(proof)) ?? false
            return ok ? .verified : .failed
        }

        return .pending
    }

    private func statusFromStoredCredential(_ status: VCLibrary.StoredCredential.Status) -> VerificationStatus {
        switch status {
        case .verified:
            return .verified
        case .unverified:
            return .unverified
        case .failed, .revoked:
            return .failed
        }
    }
}

// MARK: - AVCaptureMetadataOutputObjectsDelegate

extension QRCodeScanService: AVCaptureMetadataOutputObjectsDelegate {
    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard
            let metadataObject = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
            let value = metadataObject.stringValue
        else { return }

        stopScanning()
        process(scannedString: value)
    }
}

private extension JSONDecoder {
    static var qrDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
