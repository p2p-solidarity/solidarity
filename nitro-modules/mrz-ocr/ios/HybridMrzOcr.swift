//
//  HybridMrzOcr.swift
//  MrzOcr
//
//  Apple Vision (VNRecognizeTextRequest) runs synchronously on VisionCamera's
//  worklet thread. `.accurate` is required for the dense, low-contrast OCR-B
//  glyphs in the MRZ — `.fast` misses ~15% of `<` separators. Language
//  correction is disabled because MRZ is not natural language and autocorrect
//  rewrites "0" to "O", "1" to "I", etc. We bypass `frame.toMLImage()`
//  (used by the MLKit-based barcode-scanner reference) because VNImageRequestHandler
//  accepts a raw CVPixelBuffer with an orientation hint — no allocation needed.
//  Vision's coordinate origin is bottom-left, so observations are sorted by
//  `boundingBox.maxY` descending to yield top-to-bottom reading order.
//

import CoreVideo
import NitroModules
import os
import Vision
import VisionCamera

private let mrzLog = OSLog(subsystem: "gg.solidarity.mrz-ocr", category: "scan")

private func cgImageOrientation(from orientation: CameraOrientation) -> CGImagePropertyOrientation {
  switch orientation {
  case .up: return .up
  case .right: return .right
  case .down: return .down
  case .left: return .left
  }
}

final class HybridMrzOcr: HybridMrzOcrSpec {
  func scanFrame(frame: any HybridFrameSpec) throws -> RecognizedLines {
    guard let native = frame as? HybridFrame else {
      throw RuntimeError.error(withMessage: "Frame is not a native HybridFrame")
    }
    guard let pixelBuffer = native.pixelBuffer else {
      throw RuntimeError.error(withMessage: "Frame has no pixel buffer (was it disposed?)")
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]
    request.minimumTextHeight = 0.0

    let handler = VNImageRequestHandler(
      cvPixelBuffer: pixelBuffer,
      orientation: cgImageOrientation(from: native.orientation),
      options: [:]
    )

    let startedAt = CFAbsoluteTimeGetCurrent()
    do {
      try handler.perform([request])
    } catch {
      throw RuntimeError.error(withMessage: "Vision OCR failed: \(error.localizedDescription)")
    }
    let elapsedMs = Int((CFAbsoluteTimeGetCurrent() - startedAt) * 1000)

    guard let observations = request.results, !observations.isEmpty else {
      os_log(
        "scanFrame: 0 lines in %{public}dms (frame %{public}gx%{public}g)",
        log: mrzLog,
        type: .debug,
        elapsedMs,
        native.width,
        native.height
      )
      return RecognizedLines(
        lines: [],
        confidence: 0,
        frameWidth: native.width,
        frameHeight: native.height
      )
    }

    let sorted = observations.sorted { lhs, rhs in
      lhs.boundingBox.maxY > rhs.boundingBox.maxY
    }

    var lines: [String] = []
    var minConfidence: Float = 1.0
    lines.reserveCapacity(sorted.count)
    for observation in sorted {
      guard let candidate = observation.topCandidates(1).first else {
        continue
      }
      lines.append(candidate.string)
      if candidate.confidence < minConfidence {
        minConfidence = candidate.confidence
      }
    }

    if lines.isEmpty {
      os_log(
        "scanFrame: 0 lines in %{public}dms (frame %{public}gx%{public}g)",
        log: mrzLog,
        type: .debug,
        elapsedMs,
        native.width,
        native.height
      )
      return RecognizedLines(
        lines: [],
        confidence: 0,
        frameWidth: native.width,
        frameHeight: native.height
      )
    }

    os_log(
      "scanFrame: %{public}d lines in %{public}dms (frame %{public}gx%{public}g, minConf=%.2f)",
      log: mrzLog,
      type: .debug,
      lines.count,
      elapsedMs,
      native.width,
      native.height,
      Double(minConfidence)
    )

    return RecognizedLines(
      lines: lines,
      confidence: Double(minConfidence),
      frameWidth: native.width,
      frameHeight: native.height
    )
  }
}
