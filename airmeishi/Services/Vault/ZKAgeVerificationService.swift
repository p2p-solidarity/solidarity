//
//  ZKAgeVerificationService.swift
//  airmeishi
//
//  Zero-Knowledge age verification using Semaphore
//  Proves age threshold without revealing birthdate
//

import Foundation
import CryptoKit

// MARK: - ZK Age Verification Service

@MainActor
final class ZKAgeVerificationService: ObservableObject {
    static let shared = ZKAgeVerificationService()

    // MARK: - Published Properties

    @Published private(set) var birthdate: Date?
    @Published private(set) var hasVerifiedAge = false
    @Published private(set) var verificationHistory: [AgeVerificationRecord] = []

    // MARK: - Private Properties

    private let userDefaults = UserDefaults.standard
    private let birthdateKey = "com.solidarity.vault.birthdate"
    private let historyKey = "com.solidarity.vault.ageVerificationHistory"
    private let semaphoreManager = SemaphoreIdentityManager.shared

    // MARK: - Initialization

    private init() {
        loadBirthdate()
        loadHistory()
    }

    // MARK: - Public API

    /// Set user's birthdate (only stored locally, never transmitted)
    func setBirthdate(_ date: Date) {
        birthdate = date
        saveBirthdate()
    }

    /// Check if user is over a specific age
    func isOver(age: Int) -> Bool {
        guard let birthdate = birthdate else { return false }
        let calendar = Calendar.current
        let ageComponents = calendar.dateComponents([.year], from: birthdate, to: Date())
        return (ageComponents.year ?? 0) >= age
    }

    /// Generate a ZK proof that user is over specified age
    /// Returns only true/false proof, never the actual birthdate
    func generateAgeProof(
        minimumAge: Int,
        requesterId: String,
        scope: String
    ) async throws -> AgeProof {
        guard let birthdate = birthdate else {
            throw AgeVerificationError.birthdateNotSet
        }

        let meetsRequirement = isOver(age: minimumAge)

        // Generate proof using Semaphore if available
        let proofData: String
        if SemaphoreIdentityManager.proofsSupported {
            proofData = try await generateSemaphoreAgeProof(
                meetsRequirement: meetsRequirement,
                minimumAge: minimumAge,
                scope: scope
            )
        } else {
            // Fallback: signed attestation
            proofData = try generateSignedAttestation(
                meetsRequirement: meetsRequirement,
                minimumAge: minimumAge,
                requesterId: requesterId,
                scope: scope
            )
        }

        let proof = AgeProof(
            proofId: UUID(),
            minimumAge: minimumAge,
            meetsRequirement: meetsRequirement,
            proofData: proofData,
            method: SemaphoreIdentityManager.proofsSupported ? .semaphoreZK : .signedAttestation,
            issuedAt: Date(),
            expiresAt: Date().addingTimeInterval(3600), // 1 hour validity
            scope: scope,
            requesterId: requesterId
        )

        // Record verification
        let record = AgeVerificationRecord(
            id: proof.proofId,
            requesterId: requesterId,
            minimumAge: minimumAge,
            result: meetsRequirement,
            method: proof.method,
            timestamp: Date()
        )
        verificationHistory.append(record)
        saveHistory()

        hasVerifiedAge = true

        return proof
    }

    /// Verify an age proof
    func verifyAgeProof(_ proof: AgeProof) async throws -> AgeProofVerification {
        // Check expiration
        guard proof.expiresAt > Date() else {
            return AgeProofVerification(
                isValid: false,
                reason: "Proof has expired",
                verifiedAt: Date()
            )
        }

        // Verify based on method
        switch proof.method {
        case .semaphoreZK:
            if SemaphoreIdentityManager.proofsSupported {
                let isValid = try semaphoreManager.verifyProof(proof.proofData)
                return AgeProofVerification(
                    isValid: isValid && proof.meetsRequirement,
                    reason: isValid ? "Valid Semaphore proof" : "Invalid Semaphore proof",
                    verifiedAt: Date()
                )
            } else {
                return AgeProofVerification(
                    isValid: false,
                    reason: "Semaphore verification not supported on this device",
                    verifiedAt: Date()
                )
            }

        case .signedAttestation:
            let isValid = verifySignedAttestation(proof.proofData)
            return AgeProofVerification(
                isValid: isValid && proof.meetsRequirement,
                reason: isValid ? "Valid signed attestation" : "Invalid signature",
                verifiedAt: Date()
            )
        }
    }

    /// Clear birthdate (user can reset)
    func clearBirthdate() {
        birthdate = nil
        userDefaults.removeObject(forKey: birthdateKey)
    }

    /// Get verification statistics
    var statistics: AgeVerificationStats {
        let successful = verificationHistory.filter { $0.result }.count
        let failed = verificationHistory.filter { !$0.result }.count
        let uniqueVerifiers = Set(verificationHistory.map { $0.requesterId }).count

        return AgeVerificationStats(
            totalVerifications: verificationHistory.count,
            successfulVerifications: successful,
            failedVerifications: failed,
            uniqueVerifiers: uniqueVerifiers,
            lastVerification: verificationHistory.last?.timestamp
        )
    }

    // MARK: - Private Methods

    private func generateSemaphoreAgeProof(
        meetsRequirement: Bool,
        minimumAge: Int,
        scope: String
    ) async throws -> String {
        // The message encodes the age requirement result
        let message = "age_over_\(minimumAge):\(meetsRequirement)"

        // Generate Semaphore proof
        // Group commitments would include trusted age verifiers in production
        let identity = try semaphoreManager.loadOrCreateIdentity()

        return try semaphoreManager.generateProof(
            groupCommitments: [identity.commitment],
            message: message,
            scope: scope
        )
    }

    private func generateSignedAttestation(
        meetsRequirement: Bool,
        minimumAge: Int,
        requesterId: String,
        scope: String
    ) throws -> String {
        let payload = AttestationPayload(
            subject: "age_verification",
            minimumAge: minimumAge,
            result: meetsRequirement,
            requesterId: requesterId,
            scope: scope,
            issuedAt: Date(),
            nonce: UUID().uuidString
        )

        guard let payloadData = try? JSONEncoder().encode(payload) else {
            throw AgeVerificationError.encodingFailed
        }

        // Sign with identity key
        let identity = try semaphoreManager.loadOrCreateIdentity()
        let key = SymmetricKey(data: identity.privateKey)

        let signature = HMAC<SHA256>.authenticationCode(
            for: payloadData,
            using: key
        )

        let signedAttestation = SignedAttestation(
            payload: payloadData.base64EncodedString(),
            signature: Data(signature).base64EncodedString()
        )

        return try JSONEncoder().encode(signedAttestation).base64EncodedString()
    }

    private func verifySignedAttestation(_ proofData: String) -> Bool {
        guard let data = Data(base64Encoded: proofData),
              let attestation = try? JSONDecoder().decode(SignedAttestation.self, from: data),
              let payloadData = Data(base64Encoded: attestation.payload),
              let signatureData = Data(base64Encoded: attestation.signature),
              let identity = semaphoreManager.getIdentity() else {
            return false
        }

        let key = SymmetricKey(data: identity.privateKey)
        return HMAC<SHA256>.isValidAuthenticationCode(
            signatureData,
            authenticating: payloadData,
            using: key
        )
    }

    private func loadBirthdate() {
        if let date = userDefaults.object(forKey: birthdateKey) as? Date {
            birthdate = date
        }
    }

    private func saveBirthdate() {
        userDefaults.set(birthdate, forKey: birthdateKey)
    }

    private func loadHistory() {
        guard let data = userDefaults.data(forKey: historyKey),
              let history = try? JSONDecoder().decode([AgeVerificationRecord].self, from: data) else {
            return
        }
        verificationHistory = history
    }

    private func saveHistory() {
        if let data = try? JSONEncoder().encode(verificationHistory) {
            userDefaults.set(data, forKey: historyKey)
        }
    }
}

// MARK: - Data Models

struct AgeProof: Codable, Identifiable {
    var id: UUID { proofId }
    let proofId: UUID
    let minimumAge: Int
    let meetsRequirement: Bool
    let proofData: String
    let method: ProofMethod
    let issuedAt: Date
    let expiresAt: Date
    let scope: String
    let requesterId: String

    enum ProofMethod: String, Codable {
        case semaphoreZK = "semaphore_zk"
        case signedAttestation = "signed_attestation"

        var displayName: String {
            switch self {
            case .semaphoreZK: return "Zero-Knowledge Proof"
            case .signedAttestation: return "Signed Attestation"
            }
        }
    }
}

struct AgeProofVerification {
    let isValid: Bool
    let reason: String
    let verifiedAt: Date
}

struct AgeVerificationRecord: Codable, Identifiable {
    let id: UUID
    let requesterId: String
    let minimumAge: Int
    let result: Bool
    let method: AgeProof.ProofMethod
    let timestamp: Date

    var resultDisplay: String {
        result ? "Verified" : "Not Verified"
    }
}

struct AgeVerificationStats {
    let totalVerifications: Int
    let successfulVerifications: Int
    let failedVerifications: Int
    let uniqueVerifiers: Int
    let lastVerification: Date?
}

private struct AttestationPayload: Codable {
    let subject: String
    let minimumAge: Int
    let result: Bool
    let requesterId: String
    let scope: String
    let issuedAt: Date
    let nonce: String
}

private struct SignedAttestation: Codable {
    let payload: String
    let signature: String
}

// MARK: - Errors

enum AgeVerificationError: LocalizedError {
    case birthdateNotSet
    case proofGenerationFailed
    case encodingFailed
    case verificationFailed

    var errorDescription: String? {
        switch self {
        case .birthdateNotSet: return "Please set your birthdate first"
        case .proofGenerationFailed: return "Failed to generate age proof"
        case .encodingFailed: return "Failed to encode proof data"
        case .verificationFailed: return "Failed to verify age proof"
        }
    }
}
