import XCTest
@testable import solidarity

final class QRCodeChunkingServiceTests: XCTestCase {
  func testChunkedPayloadRoundTripsOutOfOrder() throws {
    let payload = String(repeating: "proof-payload-0123456789-", count: 400)

    let frames = try QRCodeChunkingService.makeFrames(for: payload, chunkDataBytes: 512)

    XCTAssertGreaterThan(frames.count, 1)
    XCTAssertTrue(frames.allSatisfy { $0.utf8.count <= QRCodeChunkingService.maxFramePayloadBytes })

    let reassembler = QRCodeChunkReassembler()
    var completedPayload: String?

    for frame in frames.reversed() {
      switch try reassembler.ingest(frame) {
      case .progress(let progress):
        XCTAssertLessThan(progress.receivedCount, progress.totalCount)
      case .complete(let payload, let progress):
        completedPayload = payload
        XCTAssertEqual(progress.receivedCount, progress.totalCount)
      }
    }

    XCTAssertEqual(completedPayload, payload)
  }

  func testDefaultChunkingUsesLargerFramesThanConservativeFallback() throws {
    let payload = String(repeating: "proof-payload-0123456789-", count: 700)

    let defaultFrames = try QRCodeChunkingService.makeFrames(for: payload)
    let conservativeFrames = try QRCodeChunkingService.makeFrames(for: payload, chunkDataBytes: 1_200)

    XCTAssertLessThan(defaultFrames.count, conservativeFrames.count)
    XCTAssertTrue(defaultFrames.allSatisfy { $0.utf8.count <= QRCodeChunkingService.maxFramePayloadBytes })
  }

  func testTamperedChunkFailsDigestValidation() throws {
    let payload = String(repeating: "signed-proof-", count: 300)
    let frames = try QRCodeChunkingService.makeFrames(for: payload, chunkDataBytes: 256)
    let reassembler = QRCodeChunkReassembler()

    for frame in frames.dropLast() {
      _ = try reassembler.ingest(frame)
    }

    var parts = frames[frames.count - 1].split(separator: ".", omittingEmptySubsequences: false)
      .map(String.init)
    let lastCharacter = parts[5].removeLast()
    parts[5].append(lastCharacter == "A" ? "B" : "A")
    let tamperedFinalFrame = parts.joined(separator: ".")

    XCTAssertThrowsError(try reassembler.ingest(tamperedFinalFrame)) { error in
      guard case QRCodeChunkingError.digestMismatch = error else {
        XCTFail("Expected digest mismatch, got \(error)")
        return
      }
    }
  }
}
