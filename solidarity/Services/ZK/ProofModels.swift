//
//  ProofModels.swift
//  solidarity
//
//  Shared ZK proof model types to keep files small and readable
//

import Foundation

struct SelectiveDisclosureProof: Codable {
  let proofId: String
  let businessCardId: String
  let disclosedFields: [BusinessCardField: String]
  let fieldCommitments: [BusinessCardField: Data]
  let recipientId: String?
  let signature: Data
  /// Raw representation of the P-256 ECDSA verification key. Optional for
  /// backward compatibility with proofs created before key embedding was
  /// added; verification falls back to the local KeyManager pair when
  /// missing. New proofs always populate this field.
  let signerPublicKey: Data?
  let createdAt: Date
  let expiresAt: Date

  var isExpired: Bool { expiresAt < Date() }
}

struct AttributeProof: Codable {
  let proofId: String
  let businessCardId: String
  let attributeType: AttributeType
  let commitment: Data
  let signature: Data
  /// Raw representation of the P-256 ECDSA verification key (see
  /// `SelectiveDisclosureProof.signerPublicKey`).
  let signerPublicKey: Data?
  let createdAt: Date
  let expiresAt: Date

  var isExpired: Bool { expiresAt < Date() }
}

struct RangeProof: Codable {
  let proofId: String
  let businessCardId: String
  let attributeType: AttributeType
  let range: ClosedRange<Int>
  let isInRange: Bool
  let commitment: Data
  let signature: Data
  /// Raw representation of the P-256 ECDSA verification key (see
  /// `SelectiveDisclosureProof.signerPublicKey`).
  let signerPublicKey: Data?
  let createdAt: Date
  let expiresAt: Date

  var isExpired: Bool { expiresAt < Date() }
}

struct ProofVerificationResult: Codable {
  let isValid: Bool
  let reason: String
  let verifiedAt: Date
}

enum AttributeType: String, Codable, CaseIterable {
  case skill, company, title, domain

  var displayName: String {
    switch self {
    case .skill: return "Skill"
    case .company: return "Company"
    case .title: return "Job Title"
    case .domain: return "Email Domain"
    }
  }
}

struct AttributeProofData: Codable {
  let businessCardId: String
  let attributeType: AttributeType
  let hasAttribute: Bool
  let timestamp: Date
}

struct RangeProofData: Codable {
  let businessCardId: String
  let attributeType: AttributeType
  let range: ClosedRange<Int>
  let isInRange: Bool
  let timestamp: Date
}
