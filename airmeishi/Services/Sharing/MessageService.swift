import Foundation
import Combine

class MessageService: ObservableObject {
    static let shared = MessageService()
    private let baseURL = URL(string: "https://bussiness-card.kidneyweakx.com")!
    
    // 1. Exchange for Envelope (Seal)
    func sealToken(deviceToken: String) async throws -> String {
        let url = baseURL.appendingPathComponent("seal")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body = ["device_token": deviceToken]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(SealResponse.self, from: data)
        return response.sealed_route
    }
    
    // 2. Send Message (Send)
    func sendMessage(to contact: SecureContact, text: String) async throws {
        print("[MessageService] Sending message to \(contact.name), pubKey: \(contact.pubKey)")
        // Encrypt Content
        let blob = try SecureKeyManager.shared.encrypt(message: text, for: contact.pubKey)
        
        // Sign the Payload (Match Backend Expectation: JSON string of recipient_pubkey, blob, sealed_route)
        // Backend: JSON.stringify({ recipient_pubkey, blob, sealed_route })
        // We must construct this string manually to ensure exact matching of key order and format (no spaces)
        // IMPORTANT: recipient_pubkey should be the Identity Key (signPubKey), not the Encryption Key (pubKey)
        let payloadString = "{\"recipient_pubkey\":\"\(contact.signPubKey)\",\"blob\":\"\(blob)\",\"sealed_route\":\"\(contact.sealedRoute)\"}"
        
        let sig = SecureKeyManager.shared.sign(content: payloadString)
        
        // Debug: Verify locally
        let isValid = SecureKeyManager.shared.verify(
            signatureBase64: sig,
            content: payloadString,
            pubKeyBase64: SecureKeyManager.shared.mySignPubKey
        )
        print("[MessageService] Local Signature Verification: \(isValid ? "PASSED" : "FAILED")")
        if !isValid {
             print("[MessageService] WARNING: Local signature verification failed!")
        }
        
        let payload = SendRequest(
            recipient_pubkey: contact.signPubKey, // Use Identity Key for Server indexing
            blob: blob,
            sealed_route: contact.sealedRoute,
            sender_pubkey: SecureKeyManager.shared.mySignPubKey,
            sender_sig: sig
        )
        
        let url = baseURL.appendingPathComponent("send")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode != 202 {
            let responseBody = String(data: data, encoding: .utf8) ?? "Unable to decode response body"
            print("[MessageService] API Error (Status: \(httpResponse.statusCode)): \(responseBody)")
            throw NSError(domain: "API", code: httpResponse.statusCode, userInfo: [NSLocalizedDescriptionKey: responseBody])
        }
    }
    
    // 3. Receive Mail (Sync)
    func syncMessages() async throws -> [InboxMessage] {
        let myPub = SecureKeyManager.shared.mySignPubKey
        // Signed content can be timestamp, simplified here to signing PubKey to prove identity
        let sig = SecureKeyManager.shared.sign(content: myPub)
        
        // Assemble Query Params: ?pubkey=...&sig=...
        var components = URLComponents(url: baseURL.appendingPathComponent("sync"), resolvingAgainstBaseURL: true)!
        components.queryItems = [
            URLQueryItem(name: "pubkey", value: myPub),
            URLQueryItem(name: "sig", value: sig)
        ]
        
        let (data, _) = try await URLSession.shared.data(from: components.url!)
        let response = try JSONDecoder().decode(SyncResponse.self, from: data)
        return response.messages
    }
    
    // 4. Acknowledge Deletion (Ack)
    func ackMessages(ids: [String]) async {
        guard !ids.isEmpty else { return }
        
        let myPub = SecureKeyManager.shared.mySignPubKey
        // Assuming signature rule is joining all IDs, needs to align with backend
        let contentToSign = ids.joined(separator: ",")
        let sig = SecureKeyManager.shared.sign(content: contentToSign)
        
        let payload = AckRequest(message_ids: ids, pubkey: myPub, sig: sig)
        
        let url = baseURL.appendingPathComponent("ack")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(payload)
        
        _ = try? await URLSession.shared.data(for: request)
    }
    
    // Helper to get recipient ID (for compatibility or if needed)
    func getRecipientID(from contactID: UUID) -> String? {
        // This is a placeholder for backward compatibility or if we need to look up contacts
        // In the new model, we pass SecureContact directly
        return nil
    }
}
