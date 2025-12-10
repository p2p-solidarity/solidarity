import Foundation

/// Strategy for verifying Group VC Semaphore proofs
enum GroupCredentialProofStrategy: Codable, Equatable {
    /// Fixed Root: Verifies against the merkleRoot recorded at issuance time.
    /// This allows the VC to remain valid even if the group membership changes (merkle root updates),
    /// as long as the proof was valid for the root at that time.
    case fixedRoot(merkleRoot: String, merkleTreeDepth: Int, issuedAt: Date)
    
    /// Dynamic Root: Verifies against the current live merkleRoot of the group.
    /// This requires the member to generate a fresh proof for the current root every time,
    /// or for the verifier to check against a history of roots.
    case dynamicRoot(groupId: String)
}

/// Result of a Group VC proof verification
struct GroupCredentialProofVerification: Codable {
    /// Whether the proof is valid
    let isValid: Bool
    
    /// The Merkle Root used for verification
    let merkleRoot: String
    
    /// The depth of the Merkle Tree
    let merkleTreeDepth: Int
    
    /// The strategy used for verification
    let proofStrategy: GroupCredentialProofStrategy
    
    /// Optional message explaining the verification result (e.g., error reason)
    let verificationMessage: String?
}
