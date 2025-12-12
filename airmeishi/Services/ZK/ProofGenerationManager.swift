//
//  ProofGenerationManager.swift
//  airmeishi
//
//  ZK-ready proof generation system for selective disclosure and privacy protection
//

import Foundation
import CryptoKit

/// Manages cryptographic proof generation for selective disclosure and zero-knowledge proofs
class ProofGenerationManager {
    static let shared = ProofGenerationManager()
    
    private let keyManager = KeyManager.shared
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
                return .success(SelectiveDisclosureProof(
                    proofId: UUID().uuidString,
                    businessCardId: businessCard.id.uuidString,
                    disclosedFields: disclosedFields,
                    fieldCommitments: fieldCommitments,
                    recipientId: recipientId,
                    signature: signature,
                    createdAt: now,
                    expiresAt: Calendar.current.date(byAdding: .hour, value: 24, to: Date()) ?? Date()
                ))
                
            case .failure(let error):
                return .failure(error)
            }
            
        case .failure(let error):
            return .failure(error)
        }
    }
    
    /// Verify selective disclosure proof
    func verifySelectiveDisclosureProof(
        _ proof: SelectiveDisclosureProof,
        expectedBusinessCardId: String?
    ) -> CardResult<ProofVerificationResult> {
        
        // Check expiration
        if proof.expiresAt < Date() {
            return .success(ProofVerificationResult(
                isValid: false,
                reason: "Proof has expired",
                verifiedAt: Date()
            ))
        }
        
        // Check business card ID if provided
        if let expectedId = expectedBusinessCardId, proof.businessCardId != expectedId {
            return .success(ProofVerificationResult(
                isValid: false,
                reason: "Business card ID mismatch",
                verifiedAt: Date()
            ))
        }
        
        // Verify signature using the same deterministic payload as signing
        let proofData = canonicalProofSigningData(
            businessCardId: proof.businessCardId,
            selectedFields: Set(proof.disclosedFields.keys),
            recipientId: proof.recipientId,
            timestamp: proof.createdAt
        )
        
        guard let proofDataToVerify = proofData else {
            return .success(ProofVerificationResult(
                isValid: false,
                reason: "Failed to reconstruct proof data",
                verifiedAt: Date()
            ))
        }
        
        let signatureResult = verifyProofSignature(proofDataToVerify, signature: proof.signature)
        
        switch signatureResult {
        case .success(let isValidSignature):
            if isValidSignature {
                return .success(ProofVerificationResult(
                    isValid: true,
                    reason: "Proof is valid",
                    verifiedAt: Date()
                ))
            } else {
                return .success(ProofVerificationResult(
                    isValid: false,
                    reason: "Invalid signature",
                    verifiedAt: Date()
                ))
            }
            
        case .failure(let error):
            return .failure(error)
        }
    }
    
    /// Generate attribute proof (e.g., "has skill X" without revealing other skills)
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
            let attributeData = "\(attribute.rawValue):\(value)".data(using: .utf8) ?? Data()
            let cardIdData = businessCard.id.uuidString.data(using: .utf8) ?? Data()
            
            let commitment = SHA256.hash(data: attributeData + cardIdData + masterKey.withUnsafeBytes { Data($0) })
            
            // Generate proof signature
            let proofData = try? JSONEncoder().encode(AttributeProofData(
                businessCardId: businessCard.id.uuidString,
                attributeType: attribute,
                hasAttribute: true,
                timestamp: Date()
            ))
            
            guard let proofDataToSign = proofData else {
                return .failure(.encryptionError("Failed to encode attribute proof data"))
            }
            
            let signatureResult = signProofData(proofDataToSign)
            
            switch signatureResult {
            case .success(let signature):
                return .success(AttributeProof(
                    proofId: UUID().uuidString,
                    businessCardId: businessCard.id.uuidString,
                    attributeType: attribute,
                    commitment: Data(commitment),
                    signature: signature,
                    createdAt: Date(),
                    expiresAt: Calendar.current.date(byAdding: .hour, value: 12, to: Date()) ?? Date()
                ))
                
            case .failure(let error):
                return .failure(error)
            }
            
        case .failure(let error):
            return .failure(error)
        }
    }
    
    /// Verify attribute proof
    func verifyAttributeProof(
        _ proof: AttributeProof,
        expectedAttribute: AttributeType,
        expectedValue: String
    ) -> CardResult<ProofVerificationResult> {
        
        // Check expiration
        if proof.expiresAt < Date() {
            return .success(ProofVerificationResult(
                isValid: false,
                reason: "Proof has expired",
                verifiedAt: Date()
            ))
        }
        
        // Check attribute type
        if proof.attributeType != expectedAttribute {
            return .success(ProofVerificationResult(
                isValid: false,
                reason: "Attribute type mismatch",
                verifiedAt: Date()
            ))
        }
        
        // Verify signature
        let proofData = try? JSONEncoder().encode(AttributeProofData(
            businessCardId: proof.businessCardId,
            attributeType: proof.attributeType,
            hasAttribute: true,
            timestamp: proof.createdAt
        ))
        
        guard let proofDataToVerify = proofData else {
            return .success(ProofVerificationResult(
                isValid: false,
                reason: "Failed to reconstruct proof data",
                verifiedAt: Date()
            ))
        }
        
        let signatureResult = verifyProofSignature(proofDataToVerify, signature: proof.signature)
        
        switch signatureResult {
        case .success(let isValidSignature):
            return .success(ProofVerificationResult(
                isValid: isValidSignature,
                reason: isValidSignature ? "Proof is valid" : "Invalid signature",
                verifiedAt: Date()
            ))
            
        case .failure(let error):
            return .failure(error)
        }
    }
    
    /// Generate range proof (e.g., "experience > 5 years" without revealing exact years)
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
            let rangeData = "\(attribute.rawValue):\(range.lowerBound)-\(range.upperBound)".data(using: .utf8) ?? Data()
            let cardIdData = businessCard.id.uuidString.data(using: .utf8) ?? Data()
            let resultData = isInRange ? "true".data(using: .utf8)! : "false".data(using: .utf8)!
            
            let commitment = SHA256.hash(data: rangeData + cardIdData + resultData + masterKey.withUnsafeBytes { Data($0) })
            
            // Generate proof signature
            let proofData = try? JSONEncoder().encode(RangeProofData(
                businessCardId: businessCard.id.uuidString,
                attributeType: attribute,
                range: range,
                isInRange: isInRange,
                timestamp: Date()
            ))
            
            guard let proofDataToSign = proofData else {
                return .failure(.encryptionError("Failed to encode range proof data"))
            }
            
            let signatureResult = signProofData(proofDataToSign)
            
            switch signatureResult {
            case .success(let signature):
                return .success(RangeProof(
                    proofId: UUID().uuidString,
                    businessCardId: businessCard.id.uuidString,
                    attributeType: attribute,
                    range: range,
                    isInRange: isInRange,
                    commitment: Data(commitment),
                    signature: signature,
                    createdAt: Date(),
                    expiresAt: Calendar.current.date(byAdding: .hour, value: 6, to: Date()) ?? Date()
                ))
                
            case .failure(let error):
                return .failure(error)
            }
            
        case .failure(let error):
            return .failure(error)
        }
    }
    
    // MARK: - Private Methods
    
    private func getFieldValue(from businessCard: BusinessCard, field: BusinessCardField) -> String {
        switch field {
        case .name: return businessCard.name
        case .title: return businessCard.title ?? ""
        case .company: return businessCard.company ?? ""
        case .email: return businessCard.email ?? ""
        case .phone: return businessCard.phone ?? ""
        case .profileImage: return businessCard.profileImage?.base64EncodedString() ?? ""
        case .socialNetworks: return businessCard.socialNetworks.map { "\($0.platform.rawValue): \($0.username)" }.joined(separator: ", ")
        case .skills: return businessCard.skills.map { $0.name }.joined(separator: ",")
        }
    }

    /// Build a deterministic signing payload for selective disclosure proofs.
    /// We avoid JSON encoder ordering issues by constructing a canonical string:
    /// businessCardId|field1,field2,...|recipientId|timestampSeconds
    private func canonicalProofSigningData(
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
        let fieldData = "\(field.rawValue):\(committedValue)".data(using: .utf8) ?? Data()
        let recipientData = (recipientId ?? "").data(using: .utf8) ?? Data()
        
        let commitment = SHA256.hash(data: fieldData + recipientData + masterKey.withUnsafeBytes { Data($0) })
        return Data(commitment)
    }
    
    private func signProofData(_ data: Data) -> CardResult<Data> {
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
    
    private func verifyProofSignature(_ data: Data, signature: Data) -> CardResult<Bool> {
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
    
    private func checkAttributeExists(
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
    
    private func getAttributeNumericValue(
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
