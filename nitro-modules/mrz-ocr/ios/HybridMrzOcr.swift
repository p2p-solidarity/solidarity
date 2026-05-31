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

import CoreGraphics
import CoreVideo
import Foundation
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
  private let requestLock = NSLock()

  /// Adaptive region-of-interest carried frame→frame. When the previous frame
  /// located ≥2 MRZ-shaped rows, we restrict Vision to their padded union next
  /// frame so it only scans the MRZ band — far fewer text regions to detect +
  /// recognise (faster per call) and no passport-header / name distractors.
  /// `nil` means "scan the full frame", the state we reset to the instant the
  /// band is lost, so adaptive ROI can NEVER regress correctness vs. full-frame
  /// OCR. Vision's `regionOfInterest` and `VNRecognizedTextObservation.bounding`
  /// `Box` share the same normalised, bottom-left, orientation-corrected space,
  /// so the union needs no manual coordinate mapping. Guarded by `requestLock`.
  private var lastRoi: CGRect?

  private static let fullFrameRoi = CGRect(x: 0, y: 0, width: 1, height: 1)

  private lazy var textRequest: VNRecognizeTextRequest = {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]
    // Vision default (1/32 ≈ 0.0312) — match native MRZScannerService, which
    // leaves this unset. The previous 0.015 was a workaround for the old
    // low-resolution (768-wide) frame output where the MRZ glyphs were tiny;
    // it ~doubled the detector's candidate search per call for no gain now
    // that the frame is a full 1920×1080 (see MRZCameraStep's
    // FRAME_OUTPUT_RESOLUTION). Lower it again only if users must hold the
    // passport far from the lens.
    request.minimumTextHeight = 0.03125
    return request
  }()

  func scanFrame(frame: any HybridFrameSpec) throws -> MrzScanResult {
    guard let native = frame as? NativeFrame else {
      throw RuntimeError.error(withMessage: "Frame is not a native VisionCamera frame")
    }
    guard let pixelBuffer = native.sampleBuffer?.imageBuffer else {
      throw RuntimeError.error(withMessage: "Frame has no pixel buffer (was it disposed?)")
    }

    requestLock.lock()
    defer { requestLock.unlock() }
    let request = textRequest
    // Restrict to the previously located MRZ band, or scan the whole frame
    // when we have no lock yet / just lost it.
    request.regionOfInterest = lastRoi ?? Self.fullFrameRoi

    let handler = VNImageRequestHandler(
      cvPixelBuffer: pixelBuffer,
      orientation: cgImageOrientation(from: frame.orientation),
      options: [:]
    )

    let startedAt = CFAbsoluteTimeGetCurrent()
    do {
      // `scanFrame` runs back-to-back on VisionCamera's async-runner thread,
      // whose autorelease pool may not drain between calls. Vision allocates
      // sizeable autoreleased scratch per `perform`; draining it per frame
      // keeps peak memory flat instead of climbing until iOS jetsams us.
      // `request.results` survives the pool — it is retained by the request.
      try autoreleasepool {
        try handler.perform([request])
      }
    } catch {
      throw RuntimeError.error(withMessage: "Vision OCR failed: \(error.localizedDescription)")
    }
    let elapsedMs = Int((CFAbsoluteTimeGetCurrent() - startedAt) * 1000)

    guard let observations = request.results, !observations.isEmpty else {
      lastRoi = nil
      os_log(
        "scanFrame: 0 lines in %{public}dms (frame %{public}gx%{public}g)",
        log: mrzLog,
        type: .debug,
        elapsedMs,
        frame.width,
        frame.height
      )
      return MrzScanResult(
        draft: nil,
        candidateCount: 0,
        confidence: 0,
        frameWidth: frame.width,
        frameHeight: frame.height
      )
    }

    let sorted = observations.sorted { lhs, rhs in
      lhs.boundingBox.maxY > rhs.boundingBox.maxY
    }

    var lines: [String] = []
    var mrzBoxes: [CGRect] = []
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
      // Collect boxes of MRZ-shaped rows for the next frame's adaptive ROI.
      if Self.isMrzCandidate(Self.normaliseMrzLine(candidate.string)) {
        mrzBoxes.append(observation.boundingBox)
      }
    }

    if lines.isEmpty {
      lastRoi = nil
      os_log(
        "scanFrame: 0 lines in %{public}dms (frame %{public}gx%{public}g)",
        log: mrzLog,
        type: .debug,
        elapsedMs,
        frame.width,
        frame.height
      )
      return MrzScanResult(
        draft: nil,
        candidateCount: 0,
        confidence: 0,
        frameWidth: frame.width,
        frameHeight: frame.height
      )
    }

    let scan = Self.scanTD3(lines: lines)
    // Lock onto the MRZ band next frame when we clearly saw both rows; reset
    // to full-frame otherwise so a lost band re-acquires on the very next call.
    lastRoi = mrzBoxes.count >= 2 ? Self.paddedUnion(mrzBoxes) : nil
    os_log(
      "scanFrame: %{public}d lines / %{public}d candidates / draft=%{public}@ in %{public}dms (frame %{public}gx%{public}g, minConf=%.2f)",
      log: mrzLog,
      type: .debug,
      lines.count,
      scan.candidateCount,
      scan.draft == nil ? "no" : "yes",
      elapsedMs,
      frame.width,
      frame.height,
      Double(minConfidence)
    )

    return MrzScanResult(
      draft: scan.draft,
      candidateCount: Double(scan.candidateCount),
      confidence: Double(minConfidence),
      frameWidth: frame.width,
      frameHeight: frame.height
    )
  }

  private static func scanTD3(lines: [String]) -> (draft: PassportMrzDraft?, candidateCount: Int) {
    let candidates = lines
      .map(normaliseMrzLine)
      .filter(isMrzCandidate)

    guard candidates.count >= 2 else {
      return (nil, candidates.count)
    }

    let sorted = candidates.sorted { lhs, rhs in lhs.count > rhs.count }
    let head = Array(sorted.prefix(4))
    for i in 0..<head.count {
      for j in (i + 1)..<head.count {
        let a = canonicalTD3Row(head[i])
        let b = canonicalTD3Row(head[j])
        if let draft = parseTD3(line1: a, line2: b) ?? parseTD3(line1: b, line2: a) {
          return (draft, candidates.count)
        }
      }
    }

    return (nil, candidates.count)
  }

  private static func normaliseMrzLine(_ line: String) -> String {
    line
      .uppercased()
      .replacingOccurrences(of: "\\s+", with: "<", options: .regularExpression)
  }

  private static func isMrzCandidate(_ line: String) -> Bool {
    guard (20...50).contains(line.count) else { return false }
    return line.unicodeScalars.allSatisfy { scalar in
      scalar.value == 60 || (65...90).contains(scalar.value) || (48...57).contains(scalar.value)
    }
  }

  /// Padded union of the MRZ rows' bounding boxes, clamped to the unit square.
  /// Padding is generous on Y (rows are thin and drift vertically with hand
  /// shake) and moderate on X, so the band still contains the text next frame.
  private static func paddedUnion(_ boxes: [CGRect]) -> CGRect {
    var union = boxes[0]
    for box in boxes.dropFirst() {
      union = union.union(box)
    }
    let padX: CGFloat = 0.06
    let padY: CGFloat = 0.14
    let minX = max(0, union.minX - padX)
    let minY = max(0, union.minY - padY)
    let maxX = min(1, union.maxX + padX)
    let maxY = min(1, union.maxY + padY)
    return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
  }

  private static func canonicalTD3Row(_ line: String) -> String {
    if line.count > 44 {
      return String(line.prefix(44))
    }
    if line.count < 44 {
      return line.padding(toLength: 44, withPad: "<", startingAt: 0)
    }
    return line
  }

  private static func parseTD3(line1: String, line2: String) -> PassportMrzDraft? {
    guard line1.count == 44, line2.count == 44, line1.hasPrefix("P") else { return nil }
    let chars = Array(line2)

    let documentField = String(chars[0..<9])
    guard
      let documentCheckDigit = chars[9].wholeNumberValue,
      verifyCheckDigit(documentField, expected: documentCheckDigit)
    else {
      return nil
    }

    let nationality = String(chars[10..<13]).replacingOccurrences(of: "<", with: "")
    let birthDate = String(chars[13..<19])
    guard
      let birthCheckDigit = chars[19].wholeNumberValue,
      verifyCheckDigit(birthDate, expected: birthCheckDigit),
      isValidDate(birthDate)
    else {
      return nil
    }

    let expiryDate = String(chars[21..<27])
    guard
      let expiryCheckDigit = chars[27].wholeNumberValue,
      verifyCheckDigit(expiryDate, expected: expiryCheckDigit),
      isValidDate(expiryDate)
    else {
      return nil
    }

    return PassportMrzDraft(
      passportNumber: documentField.replacingOccurrences(of: "<", with: ""),
      nationalityCode: nationality,
      dateOfBirth: birthDate,
      expiryDate: expiryDate
    )
  }

  private static let mrzWeights = [7, 3, 1]

  private static func verifyCheckDigit(_ field: String, expected: Int) -> Bool {
    computeCheckDigit(field) == expected
  }

  private static func computeCheckDigit(_ field: String) -> Int {
    var sum = 0
    for (index, scalar) in field.unicodeScalars.enumerated() {
      let value: Int
      switch scalar.value {
      case 60:
        value = 0
      case 48...57:
        value = Int(scalar.value - 48)
      case 65...90:
        value = Int(scalar.value - 65) + 10
      default:
        value = 0
      }
      sum += value * mrzWeights[index % mrzWeights.count]
    }
    return sum % 10
  }

  private static func isValidDate(_ yymmdd: String) -> Bool {
    guard yymmdd.count == 6, yymmdd.allSatisfy(\.isNumber) else { return false }
    let month = Int(yymmdd.dropFirst(2).prefix(2)) ?? 0
    let day = Int(yymmdd.suffix(2)) ?? 0
    guard (1...12).contains(month) else { return false }
    let maxDay: Int
    switch month {
    case 2:
      maxDay = 29
    case 4, 6, 9, 11:
      maxDay = 30
    default:
      maxDay = 31
    }
    return (1...maxDay).contains(day)
  }
}
