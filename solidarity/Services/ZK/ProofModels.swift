//
//  ProofModels.swift
//  airmeishi
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
