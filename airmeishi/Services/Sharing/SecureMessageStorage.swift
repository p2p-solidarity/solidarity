//
//  SecureMessageStorage.swift
//  airmeishi
//
//  Manages local storage for secure messages, ensuring they are excluded from iCloud backups.
//

import Foundation

class SecureMessageStorage {
  static let shared = SecureMessageStorage()

  private let fileManager = FileManager.default
  private let directoryName = "SecureMessages"

  private init() {}

  // MARK: - Public API

  func saveLastMessage(_ text: String, from sender: String) {
    guard let directoryURL = getStorageDirectory() else { return }

    let fileURL = directoryURL.appendingPathComponent(filename(for: sender))

    do {
      try text.write(to: fileURL, atomically: true, encoding: .utf8)
      print("[SecureMessageStorage] Saved message from \(sender)")
    } catch {
      print("[SecureMessageStorage] Failed to save message: \(error)")
    }
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
