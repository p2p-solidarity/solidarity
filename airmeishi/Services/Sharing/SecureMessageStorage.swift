//
//  SecureMessageStorage.swift
//  airmeishi
//
//  Manages local storage for secure messages, ensuring they are excluded from iCloud backups.
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

  @Published var messageHistory: [String: [StoredMessage]] = [:]

  private init() {
    loadAllHistory()
  }

  // MARK: - Public API

  func saveLastMessage(_ text: String, from sender: String) {
    guard let directoryURL = getStorageDirectory() else { return }

    // Save to legacy last message file (for backward compatibility)
    let fileURL = directoryURL.appendingPathComponent(filename(for: sender))

    do {
      try text.write(to: fileURL, atomically: true, encoding: .utf8)
      print("[SecureMessageStorage] Saved message from \(sender)")
    } catch {
      print("[SecureMessageStorage] Failed to save message: \(error)")
    }

    // Also save to history
    let storedMessage = StoredMessage(text: text, timestamp: Date(), senderName: sender)
    addToHistory(storedMessage, from: sender)
  }

  func getLastMessage(from sender: String) -> String? {
    guard let directoryURL = getStorageDirectory() else { return nil }

    let fileURL = directoryURL.appendingPathComponent(filename(for: sender))

    do {
      let text = try String(contentsOf: fileURL, encoding: .utf8)
      return text
    } catch {
      // File might not exist yet, which is fine
      return nil
    }
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

    do {
      let data = try Data(contentsOf: historyURL)
      messageHistory = try JSONDecoder().decode([String: [StoredMessage]].self, from: data)
      print("[SecureMessageStorage] Loaded message history")
    } catch {
      print("[SecureMessageStorage] Failed to load history: \(error)")
    }
  }

  private func saveHistoryToDisk() {
    guard let directoryURL = getStorageDirectory() else { return }
    let historyURL = directoryURL.appendingPathComponent(historyFileName)

    do {
      let data = try JSONEncoder().encode(messageHistory)
      try data.write(to: historyURL, options: .atomic)
    } catch {
      print("[SecureMessageStorage] Failed to save history: \(error)")
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
        try fileManager.createDirectory(at: storageURL, withIntermediateDirectories: true)

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

    return storageURL
  }

  private func filename(for sender: String) -> String {
    // Sanitize sender name to be safe for filenames
    let safeName = sender.components(separatedBy: .init(charactersIn: "/\\?%*|\"<>:")).joined()
    return "\(safeName)_lastmessage.txt"
  }
}
