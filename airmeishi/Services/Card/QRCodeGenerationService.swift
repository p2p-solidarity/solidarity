import CoreImage
import Foundation
import UIKit

final class QRCodeGenerationService {
  private let encryptionManager = EncryptionManager.shared
  private let semaphoreManager = SemaphoreIdentityManager.shared
  private let proofManager = ProofGenerationManager.shared
  private let vcService: VCService

  init(vcService: VCService = VCService()) {
    self.vcService = vcService
  }

  func generateImage(
    for card: BusinessCard,
    sharingLevel: SharingLevel,
    expirationDate: Date? = nil
  ) -> CardResult<UIImage> {
    switch buildEnvelope(for: card, sharingLevel: sharingLevel, expirationDate: expirationDate) {
    case .failure(let error):
      return .failure(error)
    case .success(let envelope):
      do {
        let data = try JSONEncoder.qrEncoder.encode(envelope)
        guard let json = String(data: data, encoding: .utf8) else {
          return .failure(.sharingError("Failed to encode QR envelope"))
        }
        return generateImage(from: json)
      } catch {
        return .failure(.sharingError("Failed to encode QR envelope: \(error.localizedDescription)"))
      }
    }
  }

  func generateImage(from string: String) -> CardResult<UIImage> {
    guard let data = string.data(using: .utf8) else {
      return .failure(.sharingError("Failed to convert string to data"))
    }

    guard let filter = CIFilter(name: "CIQRCodeGenerator") else {
      return .failure(.sharingError("QR code generator not available"))
    }

    filter.setValue(data, forKey: "inputMessage")
    filter.setValue("H", forKey: "inputCorrectionLevel")

    guard let ciImage = filter.outputImage else {
      return .failure(.sharingError("Failed to generate QR code image"))
    }

    let transform = CGAffineTransform(scaleX: 10, y: 10)
    let scaledImage = ciImage.transformed(by: transform)

    let context = CIContext()
    guard let cgImage = context.createCGImage(scaledImage, from: scaledImage.extent) else {
      return .failure(.sharingError("Failed to render QR code image"))
    }

    return .success(UIImage(cgImage: cgImage))
  }

  func buildEnvelope(
    for card: BusinessCard,
    sharingLevel: SharingLevel,
    expirationDate: Date? = nil
  ) -> CardResult<QRCodeEnvelope> {
    let format = card.sharingPreferences.sharingFormat
    switch format {
    case .plaintext:
      return .success(buildPlaintextEnvelope(for: card, level: sharingLevel, expirationDate: expirationDate))
    case .zkProof:
      return buildZKEnvelope(for: card, level: sharingLevel, expirationDate: expirationDate)
    case .didSigned:
      return buildDidSignedEnvelope(for: card, level: sharingLevel, expirationDate: expirationDate)
    }
  }

  // MARK: - Builders

  private func buildPlaintextEnvelope(
    for card: BusinessCard,
    level: SharingLevel,
    expirationDate: Date?
  ) -> QRCodeEnvelope {
    let filteredCard = card.filteredCard(for: level)
    // Ensure we include our sealedRoute so the scanner can reply via Sakura
    let mySealedRoute = SecureKeyManager.shared.mySealedRoute
    let snapshot = BusinessCardSnapshot(card: filteredCard, sealedRoute: mySealedRoute)
    let shareId = UUID()
    let payload = QRPlaintextPayload(
      snapshot: snapshot,
      shareId: shareId,
      expirationDate: expirationDate
    )
    return QRCodeEnvelope(
      format: .plaintext,
      sharingLevel: level,
      shareId: shareId,
      plaintext: payload
    )
  }

  private func buildZKEnvelope(
    for card: BusinessCard,
    level: SharingLevel,
    expirationDate: Date?
  ) -> CardResult<QRCodeEnvelope> {
    let filteredCard = card.filteredCard(for: level)
    let shareUUID = UUID()
    let expires = expirationDate ?? Date().addingTimeInterval(24 * 60 * 60)

    var sdProof: SelectiveDisclosureProof?
    if card.sharingPreferences.useZK || card.sharingPreferences.sharingFormat == .zkProof {
      let allowed = card.sharingPreferences.fieldsForLevel(level)
      let proofResult = proofManager.generateSelectiveDisclosureProof(
        businessCard: card,
        selectedFields: allowed,
        recipientId: nil
      )
      if case .success(let proof) = proofResult {
        sdProof = proof
      }
    }

    let identityBundle = semaphoreManager.getIdentity() ?? (try? semaphoreManager.loadOrCreateIdentity())
    let issuerCommitment = identityBundle?.commitment
    var issuerProof: String?

    if let commitment = issuerCommitment, !commitment.isEmpty, SemaphoreIdentityManager.proofsSupported {
      issuerProof = try? semaphoreManager.generateProof(
        groupCommitments: [commitment],
        message: shareUUID.uuidString,
        scope: level.rawValue
      )
    }

    let payload = QRSharingPayload(
      businessCard: filteredCard,
      sharingLevel: level,
      expirationDate: expires,
      shareId: shareUUID,
      createdAt: Date(),
      issuerCommitment: issuerCommitment,
      issuerProof: issuerProof,
      sdProof: sdProof,
      format: .zkProof,
      sealedRoute: SecureKeyManager.shared.mySealedRoute
    )

    switch encryptionManager.encrypt(payload) {
    case .failure(let error):
      return .failure(error)
    case .success(let encryptedData):
      let base64 = encryptedData.base64EncodedString()
      let envelope = QRCodeEnvelope(
        format: .zkProof,
        sharingLevel: level,
        shareId: shareUUID,
        encryptedPayload: base64
      )
      return .success(envelope)
    }
  }

  private func buildDidSignedEnvelope(
    for card: BusinessCard,
    level: SharingLevel,
    expirationDate: Date?
  ) -> CardResult<QRCodeEnvelope> {
    let filteredCard = card.filteredCard(for: level)
    let options = VCService.IssueOptions(expiration: expirationDate)
    let issueResult = vcService.issueBusinessCardCredential(for: filteredCard, options: options)

    switch issueResult {
    case .failure(let error):
      return .failure(error)
    case .success(let credential):
      let shareId = UUID()
      let payload = QRDidSignedPayload(
        jwt: credential.jwt,
        shareId: shareId,
        expirationDate: expirationDate ?? credential.expiresAt,
        issuerDid: credential.issuerDid,
        holderDid: credential.holderDid
      )
      let envelope = QRCodeEnvelope(
        format: .didSigned,
        sharingLevel: level,
        shareId: shareId,
        didSigned: payload
      )
      return .success(envelope)
    }
  }
}
