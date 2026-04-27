import Combine
import CommonCrypto
import Foundation
import UserNotifications

class MessageService: ObservableObject {
  static let baseURL: URL = {
    guard let url = URL(string: "https://bussiness-card.kidneyweakx.com") else {
      fatalError("Invalid Base URL")
    }
    return url
  }()
  static let shared = MessageService()

  // MARK: - TLS Pinning

  static let pinnedHost = "bussiness-card.kidneyweakx.com"

  private let pinnedDelegate = PinnedSessionDelegate()
  private lazy var pinnedSession: URLSession = {
    URLSession(configuration: .default, delegate: pinnedDelegate, delegateQueue: nil)
  }()

  // MARK: - Endpoints

  // 1. Exchange for Envelope (Seal)
  func sealToken(deviceToken: String) async throws -> String {
    let url = MessageService.baseURL.appendingPathComponent("seal")
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

    let (data, _) = try await pinnedSession.data(for: request)
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
    let payloadString =
      "{\"recipient_pubkey\":\"\(contact.signPubKey)\",\"blob\":\"\(blob)\",\"sealed_route\":\"\(contact.sealedRoute)\"}"

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
      recipient_pubkey: contact.signPubKey,  // Use Identity Key for Server indexing
      blob: blob,
      sealed_route: contact.sealedRoute,
      sender_pubkey: SecureKeyManager.shared.mySignPubKey,
      sender_sig: sig
    )

    let url = MessageService.baseURL.appendingPathComponent("send")
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.addValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(payload)

    let (data, response) = try await pinnedSession.data(for: request)

    if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode != 202 {
      let responseBody = String(data: data, encoding: .utf8) ?? "Unable to decode response body"
      print("[MessageService] API Error (Status: \(httpResponse.statusCode)): \(responseBody)")
      throw NSError(domain: "API", code: httpResponse.statusCode, userInfo: [NSLocalizedDescriptionKey: responseBody])
    }
  }

  // 3. Receive Mail (Sync)
  func syncMessages() async throws -> [InboxMessage] {
    let myPub = SecureKeyManager.shared.mySignPubKey
    // Sign `pubkey || ":" || ISO8601_minute_timestamp` so the signature rotates per minute and can no
    // longer be replayed forever. The server is expected to accept signatures whose minute timestamp
    // is within +/- 1 minute of its own clock; clients within this window will validate.
    let minuteStamp = Self.iso8601MinuteTimestamp(for: Date())
    let signedContent = "\(myPub):\(minuteStamp)"
    let sig = SecureKeyManager.shared.sign(content: signedContent)

    let url = MessageService.baseURL.appendingPathComponent("sync")
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.addValue(myPub, forHTTPHeaderField: "X-Identity-PubKey")
    request.addValue(sig, forHTTPHeaderField: "X-Identity-Sig")
    request.addValue(minuteStamp, forHTTPHeaderField: "X-Identity-Timestamp")

    let (data, _) = try await pinnedSession.data(for: request)
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

    let url = MessageService.baseURL.appendingPathComponent("ack")
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.addValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONEncoder().encode(payload)

    _ = try? await pinnedSession.data(for: request)
  }

  // Helper to get recipient ID (for compatibility or if needed)
  func getRecipientID(from contactID: UUID) -> String? {
    // This is a placeholder for backward compatibility or if we need to look up contacts
    // In the new model, we pass SecureContact directly
    return nil
  }

  /// Produces an ISO-8601 timestamp truncated to the minute (UTC). Used as the rotating component
  /// of the /sync request signature so that captured headers cease to be valid after one minute.
  private static func iso8601MinuteTimestamp(for date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.formatOptions = [.withInternetDateTime]
    let truncated = Date(timeIntervalSince1970: floor(date.timeIntervalSince1970 / 60.0) * 60.0)
    return formatter.string(from: truncated)
  }

  // MARK: - Message Processing & Polling

  private var pollingTimer: AnyCancellable?
  private var autoSyncObserver: NSObjectProtocol?

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
                MessageEventKey.text: decryptedText,
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
  /// Uses interval from NotificationSettingsManager if not specified
  func startPolling(interval: TimeInterval? = nil) {
    stopPolling()

    let pollingInterval =
      interval ?? TimeInterval(NotificationSettingsManager.shared.syncIntervalSeconds)
    print("[MessageService] Starting polling (interval: \(pollingInterval)s)")
    pollingTimer = Timer.publish(every: pollingInterval, on: .main, in: .common)
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

    // Listen for auto-sync setting changes (store observer for cleanup)
    autoSyncObserver = NotificationCenter.default.addObserver(
      forName: .autoSyncSettingChanged,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      if let enabled = notification.userInfo?["enabled"] as? Bool {
        if enabled {
          self?.startPolling()
        } else {
          self?.stopPolling()
        }
      }
    }
  }

  /// Stop polling
  func stopPolling() {
    pollingTimer?.cancel()
    pollingTimer = nil
    if let observer = autoSyncObserver {
      NotificationCenter.default.removeObserver(observer)
      autoSyncObserver = nil
    }
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
      let encPubKey = contact.pubKey ?? pubKey  // Fallback to looked-up key if missing? Unlikely if we found it.

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

// MARK: - URLSession Delegate (TLS Pinning)

/// Pins the SPKI hash of the server certificate for the messaging backend host.
///
/// Trust policy:
///  - Pin set non-empty + leaf SPKI matches → accept.
///  - Pin set non-empty + no match           → REJECT (fail closed).
///  - Pin set empty in release builds         → REJECT (fail closed).
///  - Pin set empty in DEBUG builds           → accept after system trust eval
///    (development convenience; surfaced loudly in the log).
///
/// Pin values are sourced from `MessageServerPinning.pinnedSPKIHashes(for:)`
/// so future commits can drop in the real values without changing this file.
final class PinnedSessionDelegate: NSObject, URLSessionDelegate {
  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
          let serverTrust = challenge.protectionSpace.serverTrust else {
      completionHandler(.performDefaultHandling, nil)
      return
    }

    // Only enforce pinning for our backend host; everything else uses default trust evaluation.
    guard challenge.protectionSpace.host == MessageService.pinnedHost else {
      completionHandler(.performDefaultHandling, nil)
      return
    }

    // Validate the chain via the system first so we still get hostname / expiry checks.
    var trustError: CFError?
    let trusted = SecTrustEvaluateWithError(serverTrust, &trustError)
    guard trusted else {
      print("[MessageService][TLS] System trust evaluation failed for \(MessageService.pinnedHost): \(String(describing: trustError))")
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }

    let pins = MessageServerPinning.pinnedSPKIHashes(for: MessageService.pinnedHost)

    // Empty pin set: fail closed in production, allow only in DEBUG with a warning.
    if pins.isEmpty {
      if MessageServerPinning.allowsUnpinnedFallback {
        #if DEBUG
        print(
          "[MessageService][TLS][WARNING] No SPKI pins configured for \(MessageService.pinnedHost). " +
          "Falling back to system trust (DEBUG only). Configure pins in MessageServerPinning before shipping."
        )
        completionHandler(.useCredential, URLCredential(trust: serverTrust))
        return
        #endif
      }
      print(
        "[MessageService][TLS] No SPKI pins configured for \(MessageService.pinnedHost); " +
        "rejecting connection (release builds require explicit pinning)."
      )
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }

    guard let leaf = MessageService.leafCertificate(from: serverTrust),
          let spki = MessageService.subjectPublicKeyInfoData(from: leaf) else {
      print("[MessageService][TLS] Could not extract leaf SPKI for pin verification")
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }

    let leafHash = MessageService.sha256Base64(spki)
    if pins.contains(leafHash) {
      completionHandler(.useCredential, URLCredential(trust: serverTrust))
    } else {
      print("[MessageService][TLS] SPKI pin mismatch for \(MessageService.pinnedHost). Got \(leafHash); expected one of \(pins).")
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }
}

// MARK: - SPKI helpers

extension MessageService {
  fileprivate static func leafCertificate(from trust: SecTrust) -> SecCertificate? {
    if let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = chain.first {
      return leaf
    }
    return nil
  }

  fileprivate static func subjectPublicKeyInfoData(from certificate: SecCertificate) -> Data? {
    guard let publicKey = SecCertificateCopyKey(certificate),
          let data = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
      return nil
    }
    return data
  }

  fileprivate static func sha256Base64(_ data: Data) -> String {
    var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
    data.withUnsafeBytes {
      _ = CC_SHA256($0.baseAddress, CC_LONG(data.count), &hash)
    }
    return Data(hash).base64EncodedString()
  }
}
