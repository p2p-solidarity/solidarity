import CryptoKit
import Foundation

enum QRCodeChunkingError: Error, Equatable {
  case invalidChunkSize
  case payloadTooLarge
  case frameTooLarge
  case malformedFrame
  case invalidFrameMetadata
  case chunkConflict
  case digestMismatch
}

struct QRCodeChunkProgress: Equatable {
  let sessionId: String
  let receivedCount: Int
  let totalCount: Int

  var fractionCompleted: Double {
    guard totalCount > 0 else { return 0 }
    return Double(receivedCount) / Double(totalCount)
  }
}

enum QRCodeChunkIngestResult {
  case progress(QRCodeChunkProgress)
  case complete(String, QRCodeChunkProgress)
}

enum QRCodeChunkingService {
  static let prefix = "sqc1"
  static let minChunkDataBytes = 512
  static let defaultChunkDataBytes = 2_100
  static let maxFramePayloadBytes = 2_950
  static let maxReassembledPayloadBytes = 256 * 1024
  static let maxChunkCount = 512

  static func isChunkFrame(_ value: String) -> Bool {
    value.hasPrefix("\(prefix).")
  }

  static func makeFrames(
    for payload: String,
    chunkDataBytes: Int = defaultChunkDataBytes
  ) throws -> [String] {
    guard chunkDataBytes > 0 else { throw QRCodeChunkingError.invalidChunkSize }

    let payloadData = Data(payload.utf8)
    guard payloadData.count <= maxReassembledPayloadBytes else {
      throw QRCodeChunkingError.payloadTooLarge
    }

    let sessionId = UUID().uuidString.replacingOccurrences(of: "-", with: "")
    let digest = sha256Hex(payloadData)
    let totalCount = max(1, Int(ceil(Double(payloadData.count) / Double(chunkDataBytes))))
    guard totalCount <= maxChunkCount else { throw QRCodeChunkingError.payloadTooLarge }

    var frames: [String] = []
    frames.reserveCapacity(totalCount)

    for index in 0..<totalCount {
      let start = index * chunkDataBytes
      let end = min(start + chunkDataBytes, payloadData.count)
      let chunk = start < end ? payloadData.subdata(in: start..<end) : Data()
      let encodedChunk = chunk.base64URLEncodedString()
      let frame = [prefix, sessionId, "\(index)", "\(totalCount)", digest, encodedChunk]
        .joined(separator: ".")

      guard frame.utf8.count <= maxFramePayloadBytes else {
        throw QRCodeChunkingError.frameTooLarge
      }
      frames.append(frame)
    }

    return frames
  }

  fileprivate static func parseFrame(_ value: String) throws -> QRCodeChunkFrame {
    let parts = value.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 6, parts[0] == prefix else {
      throw QRCodeChunkingError.malformedFrame
    }

    guard
      let index = Int(parts[2]),
      let totalCount = Int(parts[3]),
      index >= 0,
      totalCount > 0,
      index < totalCount,
      totalCount <= maxChunkCount,
      parts[4].count == 64,
      let chunkData = Data(base64URLEncoded: String(parts[5]))
    else {
      throw QRCodeChunkingError.invalidFrameMetadata
    }

    let frame = QRCodeChunkFrame(
      sessionId: String(parts[1]),
      index: index,
      totalCount: totalCount,
      digest: String(parts[4]),
      chunkData: chunkData
    )

    guard frame.sessionId.isEmpty == false else {
      throw QRCodeChunkingError.invalidFrameMetadata
    }
    return frame
  }

  fileprivate static func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data)
      .map { String(format: "%02x", $0) }
      .joined()
  }
}

private struct QRCodeChunkFrame {
  let sessionId: String
  let index: Int
  let totalCount: Int
  let digest: String
  let chunkData: Data
}

final class QRCodeChunkReassembler {
  private var sessionId: String?
  private var totalCount: Int?
  private var digest: String?
  private var chunks: [Int: Data] = [:]

  func reset() {
    sessionId = nil
    totalCount = nil
    digest = nil
    chunks = [:]
  }

  func ingest(_ value: String) throws -> QRCodeChunkIngestResult {
    let frame = try QRCodeChunkingService.parseFrame(value)

    if sessionId != nil, sessionId != frame.sessionId {
      reset()
    }

    if sessionId == nil {
      sessionId = frame.sessionId
      totalCount = frame.totalCount
      digest = frame.digest
    }

    guard totalCount == frame.totalCount, digest == frame.digest else {
      throw QRCodeChunkingError.invalidFrameMetadata
    }

    if let existing = chunks[frame.index] {
      guard existing == frame.chunkData else {
        throw QRCodeChunkingError.chunkConflict
      }
    } else {
      chunks[frame.index] = frame.chunkData
    }

    let progress = QRCodeChunkProgress(
      sessionId: frame.sessionId,
      receivedCount: chunks.count,
      totalCount: frame.totalCount
    )

    guard chunks.count == frame.totalCount else {
      return .progress(progress)
    }

    var payloadData = Data()
    for index in 0..<frame.totalCount {
      guard let chunk = chunks[index] else {
        return .progress(progress)
      }
      payloadData.append(chunk)
      guard payloadData.count <= QRCodeChunkingService.maxReassembledPayloadBytes else {
        throw QRCodeChunkingError.payloadTooLarge
      }
    }

    guard QRCodeChunkingService.sha256Hex(payloadData) == frame.digest else {
      throw QRCodeChunkingError.digestMismatch
    }
    guard let payload = String(data: payloadData, encoding: .utf8) else {
      throw QRCodeChunkingError.malformedFrame
    }

    reset()
    return .complete(payload, progress)
  }
}
