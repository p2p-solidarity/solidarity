//
//  ProofGenerationManager+Verification.swift
//  solidarity
//

import CryptoKit
import Foundation

extension ProofGenerationManager {

  // MARK: - Selective Disclosure Verification

  /// Verify a selective-disclosure proof.
  ///
  /// `trustedSignerPublicKey` is the caller's independently-known public key
  /// for the expected signer (e.g. cached from a prior contact handshake).
  /// When non-nil, it MUST match the embedded `proof.signerPublicKey` —
  /// otherwise the proof is rejected as not coming from the trusted party.
  /// When nil, the call provides only structural integrity (signature is
  /// internally consistent) and not authenticity — the caller is responsible
  /// for any out-of-band trust check (e.g. issuer commitment).
  func verifySelectiveDisclosureProof(
    _ proof: SelectiveDisclosureProof,
    expectedBusinessCardId: String?,
    trustedSignerPublicKey: Data? = nil
  ) -> CardResult<ProofVerificationResult> {

    // Check expiration
    if proof.expiresAt < Date() {
      return .success(
        ProofVerificationResult(
          isValid: false,
          reason: "Proof has expired",
          verifiedAt: Date()
        )
      )
    }

    // Check business card ID if provided
    if let expectedId = expectedBusinessCardId, proof.businessCardId != expectedId {
      return .success(
        ProofVerificationResult(
          isValid: false,
          reason: "Business card ID mismatch",
          verifiedAt: Date()
        )
      )
    }

    // Cross-anchor check: when an external trust anchor was supplied, the
    // embedded key must match it. Without this guard, an attacker could
    // simply embed their own valid keypair and pass verification (the TODO
    // that this fix closes).
    if let trustedKey = trustedSignerPublicKey {
      guard let embedded = proof.signerPublicKey, embedded == trustedKey else {
        return .success(
          ProofVerificationResult(
            isValid: false,
            reason: "Proof signer key does not match trusted anchor",
            verifiedAt: Date()
          )
        )
      }
    }

    // Verify signature using the same deterministic payload as signing
    let proofData = canonicalProofSigningData(
      businessCardId: proof.businessCardId,
      selectedFields: Set(proof.disclosedFields.keys),
      recipientId: proof.recipientId,
      timestamp: proof.createdAt
    )

    guard let proofDataToVerify = proofData else {
      return .success(
        ProofVerificationResult(
          isValid: false,
          reason: "Failed to reconstruct proof data",
          verifiedAt: Date()
        )
      )
    }

    let signatureResult = verifyProofSignature(
      proofDataToVerify,
      signature: proof.signature,
      signerPublicKey: proof.signerPublicKey
    )

    switch signatureResult {
    case .success(let isValidSignature):
      if isValidSignature {
        return .success(
          ProofVerificationResult(
            isValid: true,
            reason: "Proof is valid",
            verifiedAt: Date()
          )
        )
      } else {
        return .success(
          ProofVerificationResult(
            isValid: false,
            reason: "Invalid signature",
            verifiedAt: Date()
          )
        )
      }

    case .failure(let error):
      return .failure(error)
    }
  }

  // MARK: - Attribute Proof

  func generateAttributeProof(
    businessCard: BusinessCard,
    attribute: AttributeType,
    value: String
  ) -> CardResult<AttributeProof> {

    let keyResult = keyManager.getMasterKey()

    switch keyResult {
    case .success(let masterKey):
      // Check if attribute exists
      let hasAttribute = checkAttributeExists(
        in: businessCard,
        attribute: attribute,
        value: value
      )

      if !hasAttribute {
        return .failure(.validationError("Attribute not found in business card"))
      }

      // Generate attribute commitment
      let attributeData = Data("\(attribute.rawValue):\(value)".utf8)
      let cardIdData = Data(businessCard.id.uuidString.utf8)

      let commitment = SHA256.hash(data: attributeData + cardIdData + masterKey.withUnsafeBytes { Data($0) })

      // Generate proof signature
      let proofData = try? JSONEncoder()
        .encode(
          AttributeProofData(
            businessCardId: businessCard.id.uuidString,
            attributeType: attribute,
            hasAttribute: true,
            timestamp: Date()
          )
        )

      guard let proofDataToSign = proofData else {
        return .failure(.encryptionError("Failed to encode attribute proof data"))
      }

      let signatureResult = signProofData(proofDataToSign)
      let signerKey = signerPublicKeyData()

      switch signatureResult {
      case .success(let signature):
        return .success(
          AttributeProof(
            proofId: UUID().uuidString,
            businessCardId: businessCard.id.uuidString,
            attributeType: attribute,
            commitment: Data(commitment),
            signature: signature,
            signerPublicKey: signerKey,
            createdAt: Date(),
            expiresAt: Calendar.current.date(byAdding: .hour, value: 12, to: Date()) ?? Date()
          )
        )

      case .failure(let error):
        return .failure(error)
      }

    case .failure(let error):
      return .failure(error)
    }
  }

  /// Verify an attribute proof. See `verifySelectiveDisclosureProof` for the
  /// trust-anchor semantics of `trustedSignerPublicKey`.
  func verifyAttributeProof(
    _ proof: AttributeProof,
    expectedAttribute: AttributeType,
    expectedValue: String,
    trustedSignerPublicKey: Data? = nil
  ) -> CardResult<ProofVerificationResult> {

    // Check expiration
    if proof.expiresAt < Date() {
      return .success(
        ProofVerificationResult(
          isValid: false,
          reason: "Proof has expired",
          verifiedAt: Date()
        )
      )
    }

    // Check attribute type
    if proof.attributeType != expectedAttribute {
      return .success(
        ProofVerificationResult(
          isValid: false,
          reason: "Attribute type mismatch",
          verifiedAt: Date()
        )
      )
    }

    if let trustedKey = trustedSignerPublicKey {
      guard let embedded = proof.signerPublicKey, embedded == trustedKey else {
        return .success(
          ProofVerificationResult(
            isValid: false,
            reason: "Proof signer key does not match trusted anchor",
            verifiedAt: Date()
          )
        )
      }
    }

    // Verify signature
    let proofData = try? JSONEncoder()
      .encode(
        AttributeProofData(
          businessCardId: proof.businessCardId,
          attributeType: proof.attributeType,
          hasAttribute: true,
          timestamp: proof.createdAt
        )
      )

    guard let proofDataToVerify = proofData else {
      return .success(
        ProofVerificationResult(
          isValid: false,
          reason: "Failed to reconstruct proof data",
          verifiedAt: Date()
        )
      )
    }

    let signatureResult = verifyProofSignature(
      proofDataToVerify,
      signature: proof.signature,
      signerPublicKey: proof.signerPublicKey
    )

    switch signatureResult {
    case .success(let isValidSignature):
      return .success(
        ProofVerificationResult(
          isValid: isValidSignature,
          reason: isValidSignature ? "Proof is valid" : "Invalid signature",
          verifiedAt: Date()
        )
      )

    case .failure(let error):
      return .failure(error)
    }
  }

  // MARK: - Range Proof

  func generateRangeProof(
    businessCard: BusinessCard,
    attribute: AttributeType,
    range: ClosedRange<Int>
  ) -> CardResult<RangeProof> {

    let actualValue = getAttributeNumericValue(from: businessCard, attribute: attribute)

    guard let value = actualValue else {
      return .failure(.validationError("Attribute not found or not numeric"))
    }

    let isInRange = range.contains(value)

    let keyResult = keyManager.getMasterKey()

    switch keyResult {
    case .success(let masterKey):
      // Generate range commitment
      let rangeData = Data("\(attribute.rawValue):\(range.lowerBound)-\(range.upperBound)".utf8)
      let cardIdData = Data(businessCard.id.uuidString.utf8)
      let resultData = Data((isInRange ? "true" : "false").utf8)

      let commitment = SHA256.hash(data: rangeData + cardIdData + resultData + masterKey.withUnsafeBytes { Data($0) })

      // Generate proof signature
      let proofData = try? JSONEncoder()
        .encode(
          RangeProofData(
            businessCardId: businessCard.id.uuidString,
            attributeType: attribute,
            range: range,
            isInRange: isInRange,
            timestamp: Date()
          )
        )

      guard let proofDataToSign = proofData else {
        return .failure(.encryptionError("Failed to encode range proof data"))
      }

      let signatureResult = signProofData(proofDataToSign)
      let signerKey = signerPublicKeyData()

      switch signatureResult {
      case .success(let signature):
        return .success(
          RangeProof(
            proofId: UUID().uuidString,
            businessCardId: businessCard.id.uuidString,
            attributeType: attribute,
            range: range,
            isInRange: isInRange,
            commitment: Data(commitment),
            signature: signature,
            signerPublicKey: signerKey,
            createdAt: Date(),
            expiresAt: Calendar.current.date(byAdding: .hour, value: 6, to: Date()) ?? Date()
          )
        )

      case .failure(let error):
        return .failure(error)
      }

    case .failure(let error):
      return .failure(error)
    }
  }

  // MARK: - Attribute Helpers

  func checkAttributeExists(
    in businessCard: BusinessCard,
    attribute: AttributeType,
    value: String
  ) -> Bool {
    // v2: compare the full normalized value (not a 3-char prefix). Prefix
    // matching gave attackers a tiny search space and made commitments
    // brute-forceable. We now case-fold and trim, but otherwise match the
    // entire field.
    let target = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    func norm(_ str: String?) -> String {
      (str ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
    switch attribute {
    case .skill:
      return businessCard.skills.contains { norm($0.name) == target }
    case .company:
      return norm(businessCard.company) == target
    case .title:
      return norm(businessCard.title) == target
    case .domain:
      if let email = businessCard.email {
        let domain = email.components(separatedBy: "@").last?.lowercased()
        return norm(domain) == target
      }
      return false
    }
  }

  func getAttributeNumericValue(
    from businessCard: BusinessCard,
    attribute: AttributeType
  ) -> Int? {
    switch attribute {
    case .skill:
      // Return number of skills
      return businessCard.skills.count
    case .company, .title, .domain:
      // These are not numeric attributes
      return nil
    }
  }
}
