//
//  ProofGenerationManager+Verification.swift
//  solidarity
//

import CryptoKit
import Foundation

extension ProofGenerationManager {

  // MARK: - Selective Disclosure Verification

  func verifySelectiveDisclosureProof(
    _ proof: SelectiveDisclosureProof,
    expectedBusinessCardId: String?
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

    let signatureResult = verifyProofSignature(proofDataToVerify, signature: proof.signature)

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

      switch signatureResult {
      case .success(let signature):
        return .success(
          AttributeProof(
            proofId: UUID().uuidString,
            businessCardId: businessCard.id.uuidString,
            attributeType: attribute,
            commitment: Data(commitment),
            signature: signature,
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

  func verifyAttributeProof(
    _ proof: AttributeProof,
    expectedAttribute: AttributeType,
    expectedValue: String
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

    let signatureResult = verifyProofSignature(proofDataToVerify, signature: proof.signature)

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
    // Compare by first 3 characters to avoid leaking full data and to simplify checks
    let target = String(value.prefix(3)).lowercased()
    switch attribute {
    case .skill:
      return businessCard.skills.contains { String($0.name.prefix(3)).lowercased() == target }
    case .company:
      return String((businessCard.company ?? "").prefix(3)).lowercased() == target
    case .title:
      return String((businessCard.title ?? "").prefix(3)).lowercased() == target
    case .domain:
      if let email = businessCard.email {
        let domain = email.components(separatedBy: "@").last?.lowercased()
        return String((domain ?? "").prefix(3)).lowercased() == target
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
