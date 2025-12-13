//
//  EventRepository.swift
//  airmeishi
//
//  Encrypted local persistence for event participations
//

import Foundation

final class EventRepository: ObservableObject {
  static let shared = EventRepository()

  @Published private(set) var events: [EventParticipation] = []
  private let storageManager = StorageManager.shared
  private let storageFileName = "event_participations.encrypted"

  private init() {
    _ = load()
  }

  // MARK: - Public
  @discardableResult
  func load() -> CardResult<[EventParticipation]> {
    let result: CardResult<[EventParticipation]> = loadData([EventParticipation].self, from: storageFileName)
    switch result {
    case .success(let items):
      events = items
      return .success(items)
    case .failure(let error):
      events = []
      return .failure(error)
    }
  }

  @discardableResult
  func add(_ participation: EventParticipation) -> CardResult<Void> {
    var updated = events
    updated.append(participation)
    return save(updated)
  }

  @discardableResult
  func upsert(_ participation: EventParticipation) -> CardResult<Void> {
    var updated = events
    if let idx = updated.firstIndex(where: { $0.id == participation.id }) {
      updated[idx] = participation
    } else {
      updated.append(participation)
    }
    return save(updated)
  }

  @discardableResult
  func delete(id: String) -> CardResult<Void> {
    let updated = events.filter { $0.id != id }
    return save(updated)
  }

  // MARK: - Private
  private func save(_ items: [EventParticipation]) -> CardResult<Void> {
    let result: CardResult<Void> = saveData(items, to: storageFileName)
    switch result {
    case .success:
      events = items
      return .success(())
    case .failure(let error):
      return .failure(error)
    }
  }

  private func saveData<T: Codable>(_ data: T, to fileName: String) -> CardResult<Void> {
    // Reuse StorageManager implementation via generic methods
    // Temporarily duplicate logic to allow custom filename
    let encryptionResult = EncryptionManager.shared.encrypt(data)
    switch encryptionResult {
    case .success(let encryptedData):
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

  private func loadData<T: Codable>(_ type: T.Type, from fileName: String) -> CardResult<T> {
    let fileURL = getStorageURL().appendingPathComponent(fileName)
    let fm = FileManager.default
    guard fm.fileExists(atPath: fileURL.path) else {
      return .success(
        ([] as? T)
          ?? {
            return (try? JSONDecoder().decode(T.self, from: Data("[]".utf8)))
              ?? {
                return .failure(.notFound("File not found")) as CardResult<T>
              }()
              .getOrDefault()
          }()
      )
    }
    do {
      let encryptedData = try Data(contentsOf: fileURL)
      return EncryptionManager.shared.decrypt(encryptedData, as: type)
    } catch {
      return .failure(.storageError("Failed to read file: \(error.localizedDescription)"))
    }
  }

  private func getStorageURL() -> URL {
    let fm = FileManager.default
    let documentsURL = fm.urls(for: .documentDirectory, in: .userDomainMask).first!
    return documentsURL.appendingPathComponent("AirmeishiStorage")
  }
}

extension Result {
  fileprivate func getOrDefault() -> Success {
    switch self {
    case .success(let value): return value
    case .failure: fatalError("Unexpected failure in default initializer")
    }
  }
}
