import Foundation
import UIKit

struct ProofQRPage: Identifiable {
  let id = UUID()
  let image: UIImage
}

enum PresentationQRPageBuilder {
  static func buildChunkedPages(
    for payload: String,
    using qrCodeManager: QRCodeManager
  ) throws -> [ProofQRPage] {
    let payloadByteCount = Data(payload.utf8).count
    let upperBound = min(
      QRCodeChunkingService.defaultChunkDataBytes,
      max(payloadByteCount, QRCodeChunkingService.minChunkDataBytes)
    )

    do {
      return try makePages(for: payload, chunkDataBytes: upperBound, using: qrCodeManager)
    } catch {
      return try findLargestWorkingPages(
        for: payload,
        using: qrCodeManager,
        highWatermark: upperBound - 1,
        initialError: error
      )
    }
  }

  private static func findLargestWorkingPages(
    for payload: String,
    using qrCodeManager: QRCodeManager,
    highWatermark: Int,
    initialError: Error
  ) throws -> [ProofQRPage] {
    var low = QRCodeChunkingService.minChunkDataBytes
    var high = highWatermark
    var bestPages: [ProofQRPage]?
    var bestError = initialError

    while low <= high {
      let chunkDataBytes = low + (high - low) / 2
      do {
        bestPages = try makePages(for: payload, chunkDataBytes: chunkDataBytes, using: qrCodeManager)
        low = chunkDataBytes + 1
      } catch {
        bestError = error
        high = chunkDataBytes - 1
      }
    }

    if let bestPages {
      return bestPages
    }
    throw bestError
  }

  private static func makePages(
    for payload: String,
    chunkDataBytes: Int,
    using qrCodeManager: QRCodeManager
  ) throws -> [ProofQRPage] {
    let frames = try QRCodeChunkingService.makeFrames(for: payload, chunkDataBytes: chunkDataBytes)
    return try frames.map { frame in
      switch qrCodeManager.generateQRCode(from: frame) {
      case .success(let image):
        return ProofQRPage(image: image)
      case .failure(let error):
        throw error
      }
    }
  }
}
