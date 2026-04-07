import Compression
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
    // Respect the card's sharingFormat instead of always generating plaintext.
    let format = card.sharingPreferences.sharingFormat
    switch format {
    case .plaintext:
      return generatePlaintextImage(for: card, fields: fields, expirationDate: expirationDate)
    case .zkProof, .didSigned:
      // Try format-aware envelope. If it fails at any stage (biometric auth,
      // QR too large, encoding error), fall back to plaintext so the QR is
      // never empty.
      if case .success(let envelope) = buildEnvelope(for: card, sharingLevel: .public, expirationDate: expirationDate),
         case .success(let image) = encodeEnvelopeToImage(envelope) {
        return .success(image)
      }
      return generatePlaintextImage(for: card, fields: fields, expirationDate: expirationDate)
    }
  }

  private func generatePlaintextImage(
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
    return encodeEnvelopeToImage(envelope)
  }

  private func encodeEnvelopeToImage(_ envelope: QRCodeEnvelope) -> CardResult<UIImage> {
    // For didSigned: encode just the JWT string directly into the QR.
    // JWTs are self-describing (start with "eyJ") and the scanner detects them.
    // This avoids the envelope JSON wrapper overhead that pushes past QR limits.
    if envelope.format == .didSigned, let jwt = envelope.didSigned?.jwt {
      return generateImage(from: jwt, correctionLevel: "L")
    }

    do {
      let data = try JSONEncoder.qrEncoder.encode(envelope)
      // For ZK formats, try compression and use lower correction level.
      if envelope.format == .zkProof {
        if let compressed = Self.compressForQR(data) {
          return generateImage(from: compressed, correctionLevel: "M")
        }
      }
      guard let json = String(data: data, encoding: .utf8) else {
        return .failure(.sharingError("Failed to encode QR envelope"))
      }
      // Plaintext uses high correction; signed formats use medium.
      let level = envelope.format == .plaintext ? "H" : "M"
      return generateImage(from: json, correctionLevel: level)
    } catch {
      return .failure(.sharingError("Failed to encode QR envelope: \(error.localizedDescription)"))
    }
  }

  /// Compresses JSON data using zlib and encodes as a URI-safe string.
  /// Format: "sce1:" prefix + base64url(zlib(data)).
  /// Returns nil if compression doesn't reduce size or fails.
  static func compressForQR(_ data: Data) -> String? {
    let sourceSize = data.count
    let destinationBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: sourceSize)
    defer { destinationBuffer.deallocate() }

    let compressedSize = data.withUnsafeBytes { sourceBuffer -> Int in
      guard let baseAddress = sourceBuffer.baseAddress else { return 0 }
      return compression_encode_buffer(
        destinationBuffer, sourceSize,
        baseAddress.assumingMemoryBound(to: UInt8.self), sourceSize,
        nil,
        COMPRESSION_ZLIB
      )
    }

    guard compressedSize > 0 else { return nil }
    let compressedData = Data(bytes: destinationBuffer, count: compressedSize)
    let encoded = compressedData.base64URLEncodedString()
    let result = "sce1:\(encoded)"
    // Only use compression if it actually reduces size
    guard result.count < sourceSize else { return nil }
    return result
  }

  /// Decompresses a "sce1:" prefixed QR string back to JSON.
  static func decompressQR(_ string: String) -> Data? {
    guard string.hasPrefix("sce1:") else { return nil }
    let encoded = String(string.dropFirst(5))
    guard let compressedData = Data(base64URLEncoded: encoded) else { return nil }

    let destinationSize = compressedData.count * 10  // generous buffer
    let destinationBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: destinationSize)
    defer { destinationBuffer.deallocate() }

    let decompressedSize = compressedData.withUnsafeBytes { sourceBuffer -> Int in
      guard let baseAddress = sourceBuffer.baseAddress else { return 0 }
      return compression_decode_buffer(
        destinationBuffer, destinationSize,
        baseAddress.assumingMemoryBound(to: UInt8.self), compressedData.count,
        nil,
        COMPRESSION_ZLIB
      )
    }

    guard decompressedSize > 0 else { return nil }
    return Data(bytes: destinationBuffer, count: decompressedSize)
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
      return encodeEnvelopeToImage(envelope)
    }
  }

  func generateImage(from string: String, correctionLevel: String = "H") -> CardResult<UIImage> {
    guard let data = string.data(using: .utf8) else {
      return .failure(.sharingError("Failed to convert string to data"))
    }

    guard let filter = CIFilter(name: "CIQRCodeGenerator") else {
      return .failure(.sharingError("QR code generator not available"))
    }

    filter.setValue(data, forKey: "inputMessage")
    filter.setValue(correctionLevel, forKey: "inputCorrectionLevel")

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
    // Strip profileImage (too large for QR) and skills (unverifiable, not VC-eligible).
    var vcEligibleFields = Set(selectedFields)
    vcEligibleFields.remove(.profileImage)
    vcEligibleFields.remove(.skills)
    // Self-issued VC: the user attests to the selected fields about themselves.
    // verifiedFields is populated explicitly so VCService.verifiedOnly enforces
    // that only these attested fields enter the signed VC payload.
    let filteredCard = card
      .filteredCard(for: vcEligibleFields)
      .withAttestedFields(vcEligibleFields)
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
