import Foundation

/// Context for a credential, distinguishing between Personal and Group issuance
enum GroupCredentialContext: Codable, Equatable, Hashable {
    /// Self-issued credential (Personal VC)
    case personal
    
    /// Group-issued credential (Group VC)
    case group(GroupCredentialInfo)
    
    /// Information specific to a Group VC
    struct GroupCredentialInfo: Codable, Equatable, Hashable {
        /// The ID of the group issuing the credential
        let groupId: String
        
        /// The name of the group at the time of issuance
        let groupName: String
        
        /// The Merkle Root of the group at the time of issuance
        let merkleRoot: String
        
        /// The Record ID of the group owner who issued this credential
        let issuedBy: String
        
        /// Date of issuance
        let issuedAt: Date
        
        /// Whether a Semaphore proof is required for verification
        let proofRequired: Bool
    }
}
