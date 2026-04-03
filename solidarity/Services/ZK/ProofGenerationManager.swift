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

  func verifyProofSignature(_ data: Data, signature: Data) -> CardResult<Bool> {
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

  // MARK: - Private Methods

  private func generateFieldCommitment(
    field: BusinessCardField,
    value: String,
    masterKey: SymmetricKey,
    recipientId: String?
  ) -> Data {
    // Use only first 3 characters for non-name fields to limit commitment size and support lightweight verification
    let committedValue: String
    if field == .name {
      committedValue = value
    } else {
      committedValue = String(value.prefix(3))
    }
    let fieldData = Data("\(field.rawValue):\(committedValue)".utf8)
    let recipientData = Data((recipientId ?? "").utf8)

    let commitment = SHA256.hash(data: fieldData + recipientData + masterKey.withUnsafeBytes { Data($0) })
    return Data(commitment)
  }
}
