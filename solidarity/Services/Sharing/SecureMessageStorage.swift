//
//  SecureMessageStorage.swift
//  solidarity
//
//  Manages local storage for secure messages, ensuring they are excluded from iCloud backups.
//
//  Messages are persisted as AES-GCM ciphertext (key sourced from
//  `EncryptionManager`) so that a device-level file compromise — backup
//  extraction, jailbreak filesystem access, etc. — cannot recover plaintext
//  Sakura messages from the on-disk JSON / per-sender files. The complete
//  file protection class still applies on top of the encryption envelope.
//

import Foundation

struct StoredMessage: Codable, Identifiable {
  var id: UUID = UUID()
  let text: String
  let timestamp: Date
  let senderName: String
}

class SecureMessageStorage: ObservableObject {
  static let shared = SecureMessageStorage()

  private let fileManager = FileManager.default
  private let directoryName = "SecureMessages"
  private let historyFileName = "message_history.json"
  private let maxHistoryPerUser = 50  // Keep last 50 messages per user
  private let encryption = EncryptionManager.shared

  @Published var messageHistory: [String: [StoredMessage]] = [:]

  private init() {
    loadAllHistory()
  }

  // MARK: - Public API

  func saveLastMessage(_ text: String, from sender: String) {
    guard let directoryURL = getStorageDirectory() else { return }

    let fileURL = directoryURL.appendingPathComponent(filename(for: sender))

    let envelope = LastMessageEnvelope(text: text)
    switch encryption.encrypt(envelope) {
    case .success(let cipher):
      do {
        try cipher.write(to: fileURL, options: [.atomic, .completeFileProtection])
      } catch {
        #if DEBUG
        print("[SecureMessageStorage] Failed to save message: \(error)")
        #endif
      }
    case .failure(let error):
      #if DEBUG
      print("[SecureMessageStorage] Encryption failed: \(error.localizedDescription)")
      #endif
    }

    // Also save to history
    let storedMessage = StoredMessage(text: text, timestamp: Date(), senderName: sender)
    addToHistory(storedMessage, from: sender)
  }

  func getLastMessage(from sender: String) -> String? {
    guard let directoryURL = getStorageDirectory() else { return nil }

    let fileURL = directoryURL.appendingPathComponent(filename(for: sender))
    guard let data = try? Data(contentsOf: fileURL) else {
      return nil
    }

    // New format: AES-GCM-wrapped envelope produced by `saveLastMessage`.
    if case .success(let envelope) = encryption.decrypt(data, as: LastMessageEnvelope.self) {
      return envelope.text
    }

    // Legacy plaintext-on-disk fallback. Keep it readable so users with
    // existing installs don't lose their last-message context.
    return String(data: data, encoding: .utf8)
  }

  // MARK: - Message History API

  func getMessageHistory(from sender: String) -> [StoredMessage] {
    return messageHistory[sender] ?? []
  }

  func getAllMessages() -> [StoredMessage] {
    return messageHistory.values.flatMap { $0 }.sorted { $0.timestamp > $1.timestamp }
  }

  func clearHistory(for sender: String) {
    messageHistory[sender] = nil
    saveHistoryToDisk()

    // Also clear legacy file
    guard let directoryURL = getStorageDirectory() else { return }
    let fileURL = directoryURL.appendingPathComponent(filename(for: sender))
    try? fileManager.removeItem(at: fileURL)
  }

  func clearAllHistory() {
    messageHistory = [:]
    saveHistoryToDisk()

    // Also clear legacy files
    guard let directoryURL = getStorageDirectory() else { return }
    try? fileManager.removeItem(at: directoryURL)
  }

  // MARK: - Private Methods

  private func addToHistory(_ message: StoredMessage, from sender: String) {
    var history = messageHistory[sender] ?? []
    history.insert(message, at: 0)  // Most recent first

    // Limit history size
    if history.count > maxHistoryPerUser {
      history = Array(history.prefix(maxHistoryPerUser))
    }

    messageHistory[sender] = history
    saveHistoryToDisk()
  }

  private func loadAllHistory() {
    guard let directoryURL = getStorageDirectory() else { return }
    let historyURL = directoryURL.appendingPathComponent(historyFileName)

    guard fileManager.fileExists(atPath: historyURL.path) else { return }
    guard let data = try? Data(contentsOf: historyURL) else { return }

    // New format: AES-GCM-wrapped JSON. Decrypt and decode in one step.
    if case .success(let history) = encryption.decrypt(data, as: [String: [StoredMessage]].self) {
      messageHistory = history
      return
    }

    // Legacy plaintext JSON written before the encryption upgrade. Read,
    // adopt into memory, then re-persist as ciphertext on the next save so
    // the on-disk copy is upgraded transparently.
    if let history = try? JSONDecoder().decode([String: [StoredMessage]].self, from: data) {
      messageHistory = history
      saveHistoryToDisk()
    }
  }

  private func saveHistoryToDisk() {
    guard let directoryURL = getStorageDirectory() else { return }
    let historyURL = directoryURL.appendingPathComponent(historyFileName)

    switch encryption.encrypt(messageHistory) {
    case .success(let cipher):
      do {
        try cipher.write(to: historyURL, options: [.atomic, .completeFileProtection])
      } catch {
        #if DEBUG
        print("[SecureMessageStorage] Failed to save history: \(error)")
        #endif
      }
    case .failure(let error):
      #if DEBUG
      print("[SecureMessageStorage] History encryption failed: \(error.localizedDescription)")
      #endif
    }
  }

  // MARK: - Helpers

  private func getStorageDirectory() -> URL? {
    guard let documentsURL = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first else {
      return nil
    }

    let storageURL = documentsURL.appendingPathComponent(directoryName)

    if !fileManager.fileExists(atPath: storageURL.path) {
      do {
        try fileManager.createDirectory(
          at: storageURL,
          withIntermediateDirectories: true,
          attributes: [.protectionKey: FileProtectionType.complete]
        )

        // CRITICAL: Exclude from iCloud backup
        var url = storageURL
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try url.setResourceValues(resourceValues)

        print("[SecureMessageStorage] Created storage directory with isExcludedFromBackup = true")
      } catch {
        print("[SecureMessageStorage] Failed to create directory: \(error)")
        return nil
      }
    }

    // Re-apply complete protection in case directory predates this hardening.
    try? fileManager.setAttributes(
      [.protectionKey: FileProtectionType.complete],
      ofItemAtPath: storageURL.path
    )

    return storageURL
  }

  private func filename(for sender: String) -> String {
    // Sanitize sender name to be safe for filenames
    let safeName = sender.components(separatedBy: .init(charactersIn: "/\\?%*|\"<>:")).joined()
    return "\(safeName)_lastmessage.txt"
  }
}

// MARK: - On-disk envelope

/// Codable wrapper used so the per-sender "last message" file can flow
/// through `EncryptionManager` (which is generic over `Codable`).
private struct LastMessageEnvelope: Codable {
  let text: String
}
