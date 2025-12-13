//
//  DIDDocumentExporter.swift
//  airmeishi
//
//  Utilities for exporting DID documents for peer-to-peer distribution.
//

import Foundation

/// Handles packaging DID documents for sharing (AirDrop, Files, etc).
final class DIDDocumentExporter {
  private let fileManager: FileManager
  private let encoder: JSONEncoder
  private let directoryName = "airmeishi-did-docs"

  init(fileManager: FileManager = .default, encoder: JSONEncoder? = nil) {
    self.fileManager = fileManager
    let jsonEncoder = encoder ?? JSONEncoder()
    jsonEncoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    self.encoder = jsonEncoder
  }

  /// Encodes the DID document to JSON data.
  func data(for document: DIDDocument) -> CardResult<Data> {
    do {
      return .success(try encoder.encode(document))
    } catch {
      return .failure(.storageError("Failed to encode DID document: \(error.localizedDescription)"))
    }
  }

  /// Writes the DID document to a temporary file and returns the URL for sharing.
  func export(document: DIDDocument, fileName: String = "did.json") -> CardResult<URL> {
    switch data(for: document) {
    case .failure(let error):
      return .failure(error)
    case .success(let data):
      do {
        let directory = try makeExportDirectory()
        let url = directory.appendingPathComponent(fileName, isDirectory: false)
        try data.write(to: url, options: [.atomic])
        return .success(url)
      } catch {
        return .failure(.storageError("Failed to write DID document: \(error.localizedDescription)"))
      }
    }
  }

  /// Returns UIActivityViewController-friendly items for sharing the document.
  func activityItems(for document: DIDDocument, fileName: String = "did.json") -> CardResult<[Any]> {
    switch export(document: document, fileName: fileName) {
    case .failure(let error):
      return .failure(error)
    case .success(let url):
      return .success([url])
    }
  }

  /// Removes any previously exported DID documents from the temporary directory.
  func clearCachedExports() -> CardResult<Void> {
    let directory = temporaryDirectory().appendingPathComponent(directoryName, isDirectory: true)
    guard fileManager.fileExists(atPath: directory.path) else {
      return .success(())
    }

    do {
      try fileManager.removeItem(at: directory)
      return .success(())
    } catch {
      return .failure(.storageError("Failed to clear exported DID documents: \(error.localizedDescription)"))
    }
  }

  // MARK: - Helpers

  private func makeExportDirectory() throws -> URL {
    let directory = temporaryDirectory().appendingPathComponent(directoryName, isDirectory: true)
    if !fileManager.fileExists(atPath: directory.path) {
      try fileManager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: nil)
    }
    return directory
  }

  private func temporaryDirectory() -> URL {
    #if os(iOS)
      return fileManager.temporaryDirectory
    #else
      return URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
    #endif
  }
}
