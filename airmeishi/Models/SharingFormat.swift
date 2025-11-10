import Foundation

enum SharingFormat: String, Codable, CaseIterable, Identifiable {
    case plaintext
    case zkProof
    case didSigned

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .plaintext: return "Plaintext"
        case .zkProof: return "ZK Proof"
        case .didSigned: return "DID-Signed"
        }
    }

    var detail: String {
        switch self {
        case .plaintext:
            return "Share raw card data without cryptographic attestation."
        case .zkProof:
            return "Generate a zero-knowledge proof for the selected fields."
        case .didSigned:
            return "Sign the card payload with your DID for verifiable authenticity."
        }
    }

    var requiresZKIdentity: Bool {
        self == .zkProof
    }

    var requiresDidSignature: Bool {
        self == .didSigned
    }

    var supportsQRCode: Bool { true }
}
