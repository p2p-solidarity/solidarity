import Foundation
import Combine
import UserNotifications

class MessageService: ObservableObject {
    static let shared = MessageService()
    private let baseURL = URL(string: "https://bussiness-card.kidneyweakx.com")!
    
    // 1. Exchange for Envelope (Seal)
    func sealToken(deviceToken: String) async throws -> String {
        let url = baseURL.appendingPathComponent("seal")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        
        var body: [String: Any] = ["device_token": deviceToken]
        
        #if targetEnvironment(simulator)
        body["sandbox"] = true
        print("[MessageService] Sealing token (Sandbox: true - Simulator)")
        #else
        // On physical devices (even in DEBUG), we want real APNs behavior.
        // If the backend auto-detects based on token, we might not need this,
        // but setting it to false explicitly signals "not a simulator".
        body["sandbox"] = false
        print("[MessageService] Sealing token (Sandbox: false - Device)")
        #endif
        
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
    
    // MARK: - Message Processing & Polling
    
    private var pollingTimer: AnyCancellable?
    
    /// Process incoming messages (Sync -> Decrypt -> Notify -> Ack)
    /// Returns true if new data was processed
    func processIncomingMessages() async throws -> Bool {
        // 1. Pull (Sync)
        let messages = try await syncMessages()
        if messages.isEmpty {
            return false
        }
        
        var processedIds: [String] = []
        
        for msg in messages {
            // 2. Decrypt
            // We need to find the sender to get their public key
            if let senderContact = await findContact(pubKey: msg.owner_pubkey) {
                do {
                    let decryptedText = try SecureKeyManager.shared.decrypt(
                        blobBase64: msg.blob,
                        from: senderContact.pubKey
                    )
                    
                    // 3. Local Notification / UI Update
                    // Dispatch to main thread for UI-facing events
                    await MainActor.run {
                        // New: Notify UI that a Sakura message has been decrypted
                        NotificationCenter.default.post(
                            name: .secureMessageReceived,
                            object: nil,
                            userInfo: [
                                MessageEventKey.senderName: senderContact.name,
                                MessageEventKey.text: decryptedText
                            ]
                        )
                    }
                    
                    processedIds.append(msg.id)
                } catch {
                    print("[MessageService] Failed to decrypt message from \(senderContact.name): \(error)")
                }
            } else {
                print("[MessageService] Received message from unknown sender (PubKey: \(msg.owner_pubkey))")
            }
        }
        
        // 4. Destroy (Ack)
        if !processedIds.isEmpty {
            await ackMessages(ids: processedIds)
            return true
        }
        
        return false
    }
    
    /// Start polling for messages (Simulator only)
    func startPolling(interval: TimeInterval = 5.0) {
        stopPolling()
        
        print("[MessageService] Starting polling (interval: \(interval)s)")
        pollingTimer = Timer.publish(every: interval, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                Task {
                    do {
                        _ = try await self?.processIncomingMessages()
                    } catch {
                        // Ignore errors during polling to avoid spamming logs
                        // print("[MessageService] Polling error: \(error)")
                    }
                }
            }
    }
    
    /// Stop polling
    func stopPolling() {
        pollingTimer?.cancel()
        pollingTimer = nil
    }
    
    // Helper: Show Local Notification
    private func showLocalNotification(text: String, sender: String) {
        let content = UNMutableNotificationContent()
        content.title = sender
        content.body = text
        content.sound = .default
        
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
    
    // Helper: Find Contact
    private func findContact(pubKey: String) async -> SecureContact? {
        let result = await ContactRepository.shared.getContact(pubKey: pubKey)
        
        switch result {
        case .success(let contact):
            // Map to SecureContact
            // Ensure we have necessary keys. If signPubKey is missing, we might fail or fallback.
            guard let signPubKey = contact.signPubKey, let sealedRoute = contact.sealedRoute else {
                print("[MessageService] Contact found but missing secure keys: \(contact.businessCard.name)")
                return nil
            }
            
            // If contact.pubKey is nil, we might use the passed pubKey if that's what we looked up?
            // The method signature says `pubKey` (which is usually the signing key in the message owner_pubkey field).
            // Let's use the found contact's known keys.
            let encPubKey = contact.pubKey ?? pubKey // Fallback to looked-up key if missing? Unlikely if we found it.
            
            return SecureContact(
                name: contact.businessCard.name,
                pubKey: encPubKey,
                signPubKey: signPubKey,
                sealedRoute: sealedRoute
            )
        case .failure:
            return nil
        }
    }
}
