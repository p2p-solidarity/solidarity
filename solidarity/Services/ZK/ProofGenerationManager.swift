//
//  ProofGenerationManager.swift
//  solidarity
//
//  ZK-ready proof generation system for selective disclosure and privacy protection
//

import CryptoKit
import Foundation

/// Manages cryptographic proof generation for selective disclosure and zero-knowledge proofs
class ProofGenerationManager {
  static let shared = ProofGenerationManager()

  let keyManager = KeyManager.shared
  private let domainVerificationManager = DomainVerificationManager.shared

  private init() {}

  // MARK: - Public Methods

  /// Generate selective disclosure proof for business card fields
  func generateSelectiveDisclosureProof(
    businessCard: BusinessCard,
    selectedFields: Set<BusinessCardField>,
    recipientId: String?
  ) -> CardResult<SelectiveDisclosureProof> {

    let keyResult = keyManager.getMasterKey()

    switch keyResult {
    case .success(let masterKey):
      // Generate field commitments
      var fieldCommitments: [BusinessCardField: Data] = [:]
      var disclosedFields: [BusinessCardField: String] = [:]

      for field in BusinessCardField.allCases {
        let fieldValue = getFieldValue(from: businessCard, field: field)

        if selectedFields.contains(field) {
          // Disclosed field - include actual value
          disclosedFields[field] = fieldValue
        } else {
          // Hidden field - generate commitment
          let commitment = generateFieldCommitment(
            field: field,
            value: fieldValue,
            masterKey: masterKey,
            recipientId: recipientId
          )
          fieldCommitments[field] = commitment
        }
      }

      // Generate proof signature with deterministic payload
      let now = Date()
      let proofData = canonicalProofSigningData(
        businessCardId: businessCard.id.uuidString,
        selectedFields: selectedFields,
        recipientId: recipientId,
        timestamp: now
      )

      guard let proofDataToSign = proofData else {
        return .failure(.encryptionError("Failed to encode proof data"))
      }

      let signatureResult = signProofData(proofDataToSign)
      let signerKey = signerPublicKeyData()

      switch signatureResult {
      case .success(let signature):
        return .success(
          SelectiveDisclosureProof(
            proofId: UUID().uuidString,
            businessCardId: businessCard.id.uuidString,
            disclosedFields: disclosedFields,
            fieldCommitments: fieldCommitments,
            recipientId: recipientId,
            signature: signature,
            signerPublicKey: signerKey,
            createdAt: now,
            expiresAt: Calendar.current.date(byAdding: .hour, value: 24, to: Date()) ?? Date()
          )
        )

      case .failure(let error):
        return .failure(error)
      }

    case .failure(let error):
      return .failure(error)
    }
  }

  // MARK: - Internal Helpers

  func getFieldValue(from businessCard: BusinessCard, field: BusinessCardField) -> String {
    switch field {
    case .name: return businessCard.name
    case .title: return businessCard.title ?? ""
    case .company: return businessCard.company ?? ""
    case .email: return businessCard.email ?? ""
    case .phone: return businessCard.phone ?? ""
    case .profileImage: return businessCard.profileImage?.base64EncodedString() ?? ""
    case .socialNetworks:
      return businessCard.socialNetworks.map { "\($0.platform.rawValue): \($0.username)" }.joined(separator: ", ")
    case .skills: return businessCard.skills.map { $0.name }.joined(separator: ",")
    }
  }

  /// Build a deterministic signing payload for selective disclosure proofs.
  /// We avoid JSON encoder ordering issues by constructing a canonical string:
  /// businessCardId|field1,field2,...|recipientId|timestampSeconds
  func canonicalProofSigningData(
    businessCardId: String,
    selectedFields: Set<BusinessCardField>,
    recipientId: String?,
    timestamp: Date
  ) -> Data? {
    var fieldNames = selectedFields.map { $0.rawValue }
    fieldNames.sort()
    let ts = String(Int(timestamp.timeIntervalSince1970))
    let recipient = recipientId ?? ""
    let canonical = [businessCardId, fieldNames.joined(separator: ","), recipient, ts].joined(separator: "|")
    return canonical.data(using: .utf8)
  }

  func signProofData(_ data: Data) -> CardResult<Data> {
    let keyResult = keyManager.getSigningKeyPair()

    switch keyResult {
    case .success(let keyPair):
      do {
        let signature = try keyPair.privateKey.signature(for: data)
        return .success(signature.rawRepresentation)
      } catch {
        return .failure(.encryptionError("Failed to sign proof data: \(error.localizedDescription)"))
      }

    case .failure(let error):
      return .failure(error)
    }
  }

  /// Verify a proof signature against a public key.
  ///
  /// `signerPublicKey` is the verification key claimed by the proof envelope.
  /// When supplied, verification binds to that key — NOT to a local key
  /// derived from the verifier's own master material — so a peer-issued proof
  /// can be checked without first impersonating the peer.
  ///
  /// IMPORTANT: this function only checks the signature is internally
  /// consistent with the supplied key. The cross-anchor check (i.e. the
  /// embedded key matches an independently-trusted public key for the
  /// expected signer) lives at the higher-level `verifySelectiveDisclosureProof`
  /// / `verifyAttributeProof` entry points via the `trustedSignerPublicKey`
  /// parameter. Callers that bypass those entry points and call this
  /// function directly with `proof.signerPublicKey` get only structural
  /// integrity, not authenticity.
  ///
  /// `signerPublicKey == nil` is the legacy code path: we fall back to the
  /// verifier's local KeyManager pair, which is meaningful only for
  /// self-signed local QR rotations (the current `.zkProof` QR flow encrypts
  /// with a per-install key, so the issuer and verifier are the same user).
  func verifyProofSignature(
    _ data: Data,
    signature: Data,
    signerPublicKey: Data? = nil
  ) -> CardResult<Bool> {
    if let signerPublicKey {
      do {
        let publicKey = try P256.Signing.PublicKey(rawRepresentation: signerPublicKey)
        let ecdsaSignature = try P256.Signing.ECDSASignature(rawRepresentation: signature)
        let isValid = publicKey.isValidSignature(ecdsaSignature, for: data)
        return .success(isValid)
      } catch {
        return .success(false)
      }
    }

    let keyResult = keyManager.getSigningKeyPair()
    switch keyResult {
    case .success(let keyPair):
      do {
        let ecdsaSignature = try P256.Signing.ECDSASignature(rawRepresentation: signature)
        let isValid = keyPair.publicKey.isValidSignature(ecdsaSignature, for: data)
        return .success(isValid)
      } catch {
        return .success(false)
      }

    case .failure:
      return .success(false)
    }
  }

  /// Raw representation of the local signer's P-256 public key, used to
  /// stamp newly generated proofs so verifiers can rebuild trust without
  /// guessing the key from the verifier's own state.
  func signerPublicKeyData() -> Data? {
    guard case .success(let pair) = keyManager.getSigningKeyPair() else {
      return nil
    }
    return pair.publicKey.rawRepresentation
  }

  // MARK: - Private Methods

  // MARK: - Commitment versioning
  //
  // v1 (legacy): SHA256("<field>:<prefix3>" || recipient || masterKey).
  //   Prefix-3 over a small alphabet (~17k inputs) provides effectively no
  //   hiding — an attacker can brute-force the value from the commitment.
  // v2 (current): version-byte (0x02) || SHA256(domainSeparator || "<field>:<full>" || recipient || masterKey)
  //   Uses the full field value and a domain separator so commitments are
  //   not interchangeable with v1 / other contexts.
  //
  // Storage: legacy on-disk commitments are exactly 32 bytes (the SHA256
  // digest). v2 commitments are 33 bytes — first byte is the version tag.
  // Verification accepts both during transition; new commitments are v2 only.

  static let commitmentVersionV1: UInt8 = 0x01
  static let commitmentVersionV2: UInt8 = 0x02
  static let commitmentDomainSeparator = "solidarity.fieldCommit.v2"

  private func generateFieldCommitment(
    field: BusinessCardField,
    value: String,
    masterKey: SymmetricKey,
    recipientId: String?
  ) -> Data {
    let digest = Self.computeV2Digest(
      field: field,
      value: value,
      masterKey: masterKey,
      recipientId: recipientId
    )
    var out = Data([Self.commitmentVersionV2])
    out.append(digest)
    return out
  }

  /// Compute the SHA256 digest portion of a v2 commitment (no version byte).
  /// Exposed at type level so verification helpers can recompute deterministically.
  static func computeV2Digest(
    field: BusinessCardField,
    value: String,
    masterKey: SymmetricKey,
    recipientId: String?
  ) -> Data {
    let domain = Data(commitmentDomainSeparator.utf8)
    let fieldData = Data("\(field.rawValue):\(value)".utf8)
    let recipientData = Data((recipientId ?? "").utf8)
    let digest = SHA256.hash(data: domain + fieldData + recipientData + masterKey.withUnsafeBytes { Data($0) })
    return Data(digest)
  }

  /// Legacy v1 digest using the 3-char prefix scheme. Retained ONLY for
  /// backward-compatible verification of pre-v2 commitments still on disk.
  static func computeV1Digest(
    field: BusinessCardField,
    value: String,
    masterKey: SymmetricKey,
    recipientId: String?
  ) -> Data {
    let committedValue = (field == .name) ? value : String(value.prefix(3))
    let fieldData = Data("\(field.rawValue):\(committedValue)".utf8)
    let recipientData = Data((recipientId ?? "").utf8)
    let digest = SHA256.hash(data: fieldData + recipientData + masterKey.withUnsafeBytes { Data($0) })
    return Data(digest)
  }
}
