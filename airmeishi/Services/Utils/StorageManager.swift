//
//  StorageManager.swift
//  airmeishi
//
//  Local storage manager with encryption for business cards and contacts
//

import Foundation

/// Manages encrypted local storage for business cards and contacts
class StorageManager {
  static let shared = StorageManager()

  private let encryptionManager = EncryptionManager.shared
  private let fileManager = FileManager.default

  // Storage file names
  private let businessCardsFileName = "business_cards.encrypted"
  private let contactsFileName = "contacts.encrypted"
  private let userPreferencesFileName = "user_preferences.encrypted"

  private init() {
    createStorageDirectoryIfNeeded()
  }

  // MARK: - Public Methods

  /// Save business cards to encrypted storage
  func saveBusinessCards(_ cards: [BusinessCard]) -> CardResult<Void> {
    return saveData(cards, to: businessCardsFileName)
  }

  /// Load business cards from encrypted storage
  func loadBusinessCards() -> CardResult<[BusinessCard]> {
    return loadData([BusinessCard].self, from: businessCardsFileName)
  }

  /// Save contacts to encrypted storage
  func saveContacts(_ contacts: [Contact]) -> CardResult<Void> {
    return saveData(contacts, to: contactsFileName)
  }

  /// Load contacts from encrypted storage
  func loadContacts() -> CardResult<[Contact]> {
    return loadData([Contact].self, from: contactsFileName)
  }

  /// Save user preferences to encrypted storage
  func saveUserPreferences<T: Codable>(_ preferences: T) -> CardResult<Void> {
    return saveData(preferences, to: userPreferencesFileName)
  }

  /// Load user preferences from encrypted storage
  func loadUserPreferences<T: Codable>(_ type: T.Type) -> CardResult<T> {
    return loadData(type, from: userPreferencesFileName)
  }

  /// Clear all stored data
  func clearAllData() -> CardResult<Void> {
    let files = [businessCardsFileName, contactsFileName, userPreferencesFileName]

    for fileName in files {
      let fileURL = getStorageURL().appendingPathComponent(fileName)

      if fileManager.fileExists(atPath: fileURL.path) {
        do {
          try fileManager.removeItem(at: fileURL)
        } catch {
          return .failure(.storageError("Failed to delete file \(fileName): \(error.localizedDescription)"))
        }
      }
    }

    // Also clear encryption key
    return encryptionManager.deleteEncryptionKey()
  }

  /// Get storage directory size in bytes
  func getStorageSize() -> CardResult<Int64> {
    do {
      let storageURL = getStorageURL()
      let resourceKeys: [URLResourceKey] = [.fileSizeKey, .isDirectoryKey]

      guard
        let enumerator = fileManager.enumerator(
          at: storageURL,
          includingPropertiesForKeys: resourceKeys,
          options: [.skipsHiddenFiles]
        )
      else {
        return .failure(.storageError("Failed to create directory enumerator"))
      }

      var totalSize: Int64 = 0

      for case let fileURL as URL in enumerator {
        let resourceValues = try fileURL.resourceValues(forKeys: Set(resourceKeys))

        if resourceValues.isDirectory != true {
          totalSize += Int64(resourceValues.fileSize ?? 0)
        }
      }

      return .success(totalSize)

    } catch {
      return .failure(.storageError("Failed to calculate storage size: \(error.localizedDescription)"))
    }
  }

  /// Check if storage directory exists and is writable
  func isStorageAvailable() -> Bool {
    let storageURL = getStorageURL()
    return fileManager.isWritableFile(atPath: storageURL.path)
  }

  // MARK: - Private Methods

  /// Generic method to save encrypted data
  private func saveData<T: Codable>(_ data: T, to fileName: String) -> CardResult<Void> {
    // Encrypt the data
    let encryptionResult = encryptionManager.encrypt(data)

    switch encryptionResult {
    case .success(let encryptedData):
      // Write to file
      let fileURL = getStorageURL().appendingPathComponent(fileName)

      do {
        try encryptedData.write(to: fileURL)
        return .success(())
      } catch {
        return .failure(.storageError("Failed to write file: \(error.localizedDescription)"))
      }

    case .failure(let error):
      return .failure(error)
    }
  }

  /// Generic method to load encrypted data
  private func loadData<T: Codable>(_ type: T.Type, from fileName: String) -> CardResult<T> {
    let fileURL = getStorageURL().appendingPathComponent(fileName)

    // Check if file exists
    guard fileManager.fileExists(atPath: fileURL.path) else {
      return .failure(.notFound("File \(fileName) not found"))
    }

    do {
      // Read encrypted data
      let encryptedData = try Data(contentsOf: fileURL)

      // Decrypt the data
      return encryptionManager.decrypt(encryptedData, as: type)

    } catch {
      return .failure(.storageError("Failed to read file: \(error.localizedDescription)"))
    }
  }

  /// Get the storage directory URL
  private func getStorageURL() -> URL {
    let documentsURL = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
    return documentsURL.appendingPathComponent("AirmeishiStorage")
  }

  /// Create storage directory if it doesn't exist
  private func createStorageDirectoryIfNeeded() {
    let storageURL = getStorageURL()

    if !fileManager.fileExists(atPath: storageURL.path) {
      do {
        try fileManager.createDirectory(at: storageURL, withIntermediateDirectories: true)
      } catch {
        print("Failed to create storage directory: \(error.localizedDescription)")
      }
    }
  }
}
