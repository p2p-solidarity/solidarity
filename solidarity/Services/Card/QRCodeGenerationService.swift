import CoreImage
import Foundation
import UIKit

final class QRCodeGenerationService {
  private let encryptionManager = EncryptionManager.shared
  private let semaphoreManager = SemaphoreIdentityManager.shared
  private let semaphoreGroupManager = SemaphoreGroupManager.shared
  private let proofManager = ProofGenerationManager.shared
  private let vcService: VCService

  init(vcService: VCService = VCService()) {
    self.vcService = vcService
  }

  func generateImage(
    for card: BusinessCard,
    fields: Set<BusinessCardField>,
    expirationDate: Date? = nil
  ) -> CardResult<UIImage> {
    let filteredCard = card.filteredCard(for: fields)
    let selectedFields = fields.sorted { $0.rawValue < $1.rawValue }
    let mySealedRoute = SecureKeyManager.shared.mySealedRoute
    let snapshot = BusinessCardSnapshot(card: filteredCard, sealedRoute: mySealedRoute)
    let shareId = UUID()
    let payload = QRPlaintextPayload(
      snapshot: snapshot,
      shareId: shareId,
      expirationDate: expirationDate,
      // Plaintext payload cannot carry a cryptographic claim artifact.
      proofClaims: nil,
      selectedFields: selectedFields
    )
    let envelope = QRCodeEnvelope(
      format: .plaintext,
      sharingLevel: .public,
      selectedFields: selectedFields,
      shareId: shareId,
      plaintext: payload
    )
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
    let selectedFields = resolvedSelectedFields(for: card, legacyLevel: level)
    let filteredCard = card.filteredCard(for: Set(selectedFields))
    // Ensure we include our sealedRoute so the scanner can reply via Sakura
    let mySealedRoute = SecureKeyManager.shared.mySealedRoute
    let snapshot = BusinessCardSnapshot(card: filteredCard, sealedRoute: mySealedRoute)
    let shareId = UUID()
    let payload = QRPlaintextPayload(
      snapshot: snapshot,
      shareId: shareId,
      expirationDate: expirationDate,
      // Plaintext payload cannot carry a cryptographic claim artifact.
      proofClaims: nil,
      selectedFields: selectedFields
    )
    return QRCodeEnvelope(
      format: .plaintext,
      sharingLevel: level,
      selectedFields: selectedFields,
      shareId: shareId,
      plaintext: payload
    )
  }

  private func buildZKEnvelope(
    for card: BusinessCard,
    level: SharingLevel,
    expirationDate: Date?
  ) -> CardResult<QRCodeEnvelope> {
    let selectedFields = resolvedSelectedFields(for: card, legacyLevel: level)
    let filteredCard = card.filteredCard(for: Set(selectedFields))
    let shareUUID = UUID()
    let expires = expirationDate ?? Date().addingTimeInterval(24 * 60 * 60)
    let scope = ShareScopeResolver.scope(selectedFields: selectedFields)

    var sdProof: SelectiveDisclosureProof?
    if card.sharingPreferences.useZK || card.sharingPreferences.sharingFormat == .zkProof {
      let proofResult = proofManager.generateSelectiveDisclosureProof(
        businessCard: card,
        selectedFields: Set(selectedFields),
        recipientId: nil
      )
      if case .success(let proof) = proofResult {
        sdProof = proof
      }
    }

    let identityBundle = semaphoreManager.getIdentity() ?? (try? semaphoreManager.loadOrCreateIdentity())
    let issuerCommitment = identityBundle?.commitment
    var issuerProof: String?

    if let commitment = issuerCommitment,
      !commitment.isEmpty,
      SemaphoreIdentityManager.proofsSupported,
      let groupCommitments = semaphoreGroupManager.proofCommitments(containing: commitment)
    {
      issuerProof = try? semaphoreManager.generateProof(
        groupCommitments: groupCommitments,
        message: shareUUID.uuidString,
        scope: scope
      )
    }

    let proofClaims = filteredProofClaims(issuerProof: issuerProof, sdProof: sdProof)

    let payload = QRSharingPayload(
      businessCard: filteredCard,
      sharingLevel: level,
      selectedFields: selectedFields,
      scope: scope,
      expirationDate: expires,
      shareId: shareUUID,
      createdAt: Date(),
      issuerCommitment: issuerCommitment,
      issuerProof: issuerProof,
      sdProof: sdProof,
      format: .zkProof,
      sealedRoute: SecureKeyManager.shared.mySealedRoute,
      proofClaims: proofClaims
    )

    switch encryptionManager.encrypt(payload) {
    case .failure(let error):
      return .failure(error)
    case .success(let encryptedData):
      let base64 = encryptedData.base64EncodedString()
      let envelope = QRCodeEnvelope(
        format: .zkProof,
        sharingLevel: level,
        selectedFields: selectedFields,
        shareId: shareUUID,
        encryptedPayload: base64
      )
      return .success(envelope)
    }
  }

  private func filteredProofClaims(
    issuerProof: String?,
    sdProof: SelectiveDisclosureProof?
  ) -> [String]? {
    let claims = ShareSettingsStore.selectedProofClaims.filter { claim in
      switch claim {
      case "is_human":
        return issuerProof != nil
      case "age_over_18":
        return sdProof != nil
      default:
        return false
      }
    }
    return claims.isEmpty ? nil : claims
  }

  private func buildDidSignedEnvelope(
    for card: BusinessCard,
    level: SharingLevel,
    expirationDate: Date?
  ) -> CardResult<QRCodeEnvelope> {
    let selectedFields = resolvedSelectedFields(for: card, legacyLevel: level)
    // Self-issued VC: the user attests to the selected fields about themselves.
    // verifiedFields is populated explicitly so VCService.verifiedOnly enforces
    // that only these attested fields enter the signed VC payload.
    let filteredCard = card
      .filteredCard(for: Set(selectedFields))
      .withAttestedFields(Set(selectedFields))
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
        selectedFields: selectedFields,
        shareId: shareId,
        didSigned: payload
      )
      return .success(envelope)
    }
  }

  private func resolvedSelectedFields(
    for card: BusinessCard,
    legacyLevel: SharingLevel
  ) -> [BusinessCardField] {
    let fieldsFromToggles = ShareSettingsStore.enabledFields
    if !fieldsFromToggles.isEmpty {
      return fieldsFromToggles.sorted { $0.rawValue < $1.rawValue }
    }
    return card.sharingPreferences.effectiveFields(preferredLevel: legacyLevel).sorted { $0.rawValue < $1.rawValue }
  }
}
