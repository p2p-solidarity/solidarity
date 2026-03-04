@preconcurrency import AVFoundation
import Combine
import UIKit
import Vision

/// Scans passport MRZ (TD3 format) using the camera and Vision OCR.
@MainActor
final class MRZScannerService: NSObject, ObservableObject {
  @Published var scannedDraft: PassportMRZDraft?
  @Published var isScanning = false
  @Published var errorMessage: String?

  private let captureSession = AVCaptureSession()
  private let videoOutput = AVCaptureVideoDataOutput()
  private let processingQueue = DispatchQueue(label: "com.airmeishi.mrz-scanner", qos: .userInitiated)
  private nonisolated(unsafe) var _isProcessingFrame = false

  // MARK: - Session Setup

  func setupSession() -> AVCaptureSession? {
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
      let input = try? AVCaptureDeviceInput(device: device)
    else {
      errorMessage = "Camera not available."
      return nil
    }

    captureSession.beginConfiguration()
    captureSession.sessionPreset = .hd1920x1080

    if captureSession.canAddInput(input) {
      captureSession.addInput(input)
    }

    videoOutput.setSampleBufferDelegate(self, queue: processingQueue)
    videoOutput.alwaysDiscardsLateVideoFrames = true

    if captureSession.canAddOutput(videoOutput) {
      captureSession.addOutput(videoOutput)
    }

    captureSession.commitConfiguration()
    return captureSession
  }

  func startScanning() {
    guard !captureSession.isRunning else { return }
    scannedDraft = nil
    errorMessage = nil
    isScanning = true
    let session = captureSession
    processingQueue.async {
      session.startRunning()
    }
  }

  func stopScanning() {
    isScanning = false
    let session = captureSession
    processingQueue.async {
      session.stopRunning()
    }
  }

  // MARK: - MRZ Parsing (ICAO 9303 TD3)

  /// Parse two MRZ lines (TD3: 2 lines x 44 chars each).
  nonisolated static func parseTD3(line1: String, line2: String) -> PassportMRZDraft? {
    let l1 = line1.replacingOccurrences(of: " ", with: "")
    let l2 = line2.replacingOccurrences(of: " ", with: "")

    guard l1.count == 44, l2.count == 44 else { return nil }
    guard l1.hasPrefix("P") else { return nil }

    let idx2 = { (pos: Int) -> String.Index in l2.index(l2.startIndex, offsetBy: pos) }

    // Document number: positions 0-8 (9 chars), check digit at position 9
    let docNumber = String(l2[idx2(0)..<idx2(9)]).replacingOccurrences(of: "<", with: "")
    let docCheckDigit = Int(String(l2[idx2(9)]))
    guard let docCheckDigit, verifyCheckDigit(docNumber, expected: docCheckDigit) else { return nil }

    // Nationality: positions 10-12
    let nationality = String(l2[idx2(10)..<idx2(13)])

    // Date of birth: positions 13-18 (YYMMDD), check digit at 19
    let dobString = String(l2[idx2(13)..<idx2(19)])
    let dobCheckDigit = Int(String(l2[idx2(19)]))
    guard let dobCheckDigit, verifyCheckDigit(dobString, expected: dobCheckDigit) else { return nil }
    guard let dob = parseDate(dobString, isPast: true) else { return nil }

    // Expiry date: positions 21-26 (YYMMDD), check digit at 27
    let expiryString = String(l2[idx2(21)..<idx2(27)])
    let expiryCheckDigit = Int(String(l2[idx2(27)]))
    guard let expiryCheckDigit, verifyCheckDigit(expiryString, expected: expiryCheckDigit) else { return nil }
    guard let expiry = parseDate(expiryString, isPast: false) else { return nil }

    return PassportMRZDraft(
      passportNumber: docNumber,
      nationalityCode: nationality,
      dateOfBirth: dob,
      expiryDate: expiry
    )
  }

  // MARK: - ICAO 9303 Check Digit

  private static nonisolated let mrzWeights = [7, 3, 1]

  nonisolated static func verifyCheckDigit(_ field: String, expected: Int) -> Bool {
    return computeCheckDigit(field) == expected
  }

  nonisolated static func computeCheckDigit(_ field: String) -> Int {
    var sum = 0
    for (i, char) in field.enumerated() {
      let value: Int
      if char == "<" {
        value = 0
      } else if char.isNumber {
        value = Int(String(char)) ?? 0
      } else if char.isLetter, let ascii = char.asciiValue, let baseA = Character("A").asciiValue {
        value = Int(ascii - baseA) + 10
      } else {
        value = 0
      }
      sum += value * mrzWeights[i % 3]
    }
    return sum % 10
  }

  // MARK: - Date Parsing

  private nonisolated static func parseDate(_ yymmdd: String, isPast: Bool) -> Date? {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyMMdd"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    guard let date = formatter.date(from: yymmdd) else { return nil }

    // Disambiguate 2-digit year: for DOB prefer past, for expiry prefer future
    if isPast && date > Date() {
      return Calendar.current.date(byAdding: .year, value: -100, to: date)
    }
    return date
  }
}

// MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

extension MRZScannerService: AVCaptureVideoDataOutputSampleBufferDelegate {
  nonisolated func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    guard !_isProcessingFrame else { return }
    _isProcessingFrame = true

    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      _isProcessingFrame = false
      return
    }

    let request = VNRecognizeTextRequest { [weak self] request, _ in
      defer { self?._isProcessingFrame = false }

      guard let results = request.results as? [VNRecognizedTextObservation] else { return }

      let lines = results.compactMap { $0.topCandidates(1).first?.string }
        .map { $0.uppercased().replacingOccurrences(of: " ", with: "") }
        .filter { $0.count >= 40 }

      // Look for TD3 MRZ pair
      for i in 0..<lines.count {
        guard lines[i].hasPrefix("P") else { continue }
        for j in (i + 1)..<lines.count {
          if let draft = MRZScannerService.parseTD3(line1: lines[i], line2: lines[j]) {
            DispatchQueue.main.async {
              self?.scannedDraft = draft
              self?.isScanning = false
              self?.captureSession.stopRunning()
            }
            return
          }
        }
      }
    }

    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]

    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
    try? handler.perform([request])
  }
}
