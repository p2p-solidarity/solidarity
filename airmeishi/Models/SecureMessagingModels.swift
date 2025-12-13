import Foundation

// MARK: - Core Structure
// This is your "Business Card", which can be converted to JSON and shared with friends
struct SecureContact: Codable {
  let name: String
  let pubKey: String  // Used for encryption (X25519)
  let signPubKey: String  // Used for identity verification (Ed25519)
  let sealedRoute: String  // Blind route (for Server)
}

// MARK: - API Request/Response Models
struct SealResponse: Codable {
  let sealed_route: String
}

struct SendRequest: Codable {
  let recipient_pubkey: String
  let blob: String  // Base64 Encrypted Content
  let sealed_route: String
  let sender_pubkey: String
  let sender_sig: String  // Signature of the Blob, prevents tampering
}

struct SyncResponse: Codable {
  let messages: [InboxMessage]
}

struct InboxMessage: Codable {
  let id: String
  let owner_pubkey: String
  let blob: String
  let created_at: Double
}

struct AckRequest: Codable {
  let message_ids: [String]
  let pubkey: String
  let sig: String
}
