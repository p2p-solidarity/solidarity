import CryptoKit
import Foundation

#if canImport(NFCPassportReader)
import NFCPassportReader
#endif

// MARK: - Result type

struct NFCReadResult {
  let chipUID: String
  let dg1MRZData: String
  let bacSucceeded: Bool
  let paceSucceeded: Bool
  let passiveAuthPassed: Bool
  let rawDataHash: String
  let readAt: Date
}

// MARK: - Service

final class NFCPassportReaderService: NSObject {

  enum NFCError: LocalizedError {
    case notAvailable
    case readFailed(String)
    case cancelled

    var errorDescription: String? {
      switch self {
      case .notAvailable:
        return "NFC reading is not available on this device."
      case .readFailed(let detail):
        return "Failed to read passport: \(detail)"
      case .cancelled:
        return "NFC read was cancelled."
      }
    }
  }

  // MARK: - MRZ Key

  /// Build the mrzKey string expected by NFCPassportReader library.
  /// Format: `passportNumber(padded9)<check>DOB(YYMMDD)<check>expiry(YYMMDD)<check>`
  static func buildMRZKey(passportNumber: String, dateOfBirth: String, expiryDate: String) -> String {
    let pptNr = pad(passportNumber, fieldLength: 9)
    let dob = pad(dateOfBirth, fieldLength: 6)
    let exp = pad(expiryDate, fieldLength: 6)

    return "\(pptNr)\(checkDigit(pptNr))\(dob)\(checkDigit(dob))\(exp)\(checkDigit(exp))"
  }

  /// ICAO 9303 check digit (mod 10 weighted sum).
  static func checkDigit(_ input: String) -> Int {
    let weights = [7, 3, 1]
    var sum = 0
    for (i, char) in input.uppercased().enumerated() {
      let value: Int
      if let digit = char.wholeNumberValue {
        value = digit
      } else if char == "<" || char == " " {
        value = 0
      } else if let ascii = char.asciiValue, ascii >= Character("A").asciiValue! {
        value = Int(ascii - Character("A").asciiValue!) + 10
      } else {
        value = 0
      }
      sum += value * weights[i % 3]
    }
    return sum % 10
  }

  private static func pad(_ value: String, fieldLength: Int) -> String {
    String((value + String(repeating: "<", count: fieldLength)).prefix(fieldLength))
  }

  // MARK: - Read passport

  #if canImport(NFCPassportReader) && !targetEnvironment(simulator)
  func read(passportNumber: String, dateOfBirth: String, expiryDate: String) async throws -> NFCReadResult {
    let mrzKey = NFCPassportReaderService.buildMRZKey(
      passportNumber: passportNumber,
      dateOfBirth: dateOfBirth,
      expiryDate: expiryDate
    )

    let reader = PassportReader()

    let passport: NFCPassportModel
    do {
      passport = try await reader.readPassport(
        mrzKey: mrzKey,
        tags: [.COM, .SOD, .DG1, .DG2, .DG14, .DG15],
        skipSecureElements: false,
        skipCA: false,
        skipPACE: false,
        customDisplayMessage: { message in
          switch message {
          case .requestPresentPassport:
            return "Hold your passport against the back of your iPhone."
          case .authenticatingWithPassport(let progress):
            return "Authenticating... \(progress)%"
          case .readingDataGroupProgress(let dg, let progress):
            return "Reading \(dg)... \(progress)%"
          case .error(let error):
            return "Error: \(error.localizedDescription)"
          case .successfulRead:
            return "Passport read successfully!"
          default:
            return nil
          }
        }
      )
    } catch {
      let desc = error.localizedDescription
      if desc.contains("cancel") || desc.contains("Cancel") || desc.contains("invalidat") {
        throw NFCError.cancelled
      }
      throw NFCError.readFailed(desc)
    }

    // Extract MRZ from DG1
    let mrzData = passport.passportMRZ

    // Determine authentication status
    let bacOK = passport.BACStatus == .success
    let paceOK = passport.PACEStatus == .success

    // Passive authentication
    let passiveOK = passport.passportCorrectlySigned && passport.passportDataNotTampered

    // Build chip UID from document number (no direct UID exposed by library)
    let chipUID = passport.documentNumber.isEmpty
      ? "NFC-\(UUID().uuidString.prefix(8))"
      : "NFC-\(passport.documentNumber)"

    // Hash all DG1 raw data for integrity
    let dg1Raw = passport.getDataGroup(.DG1)
    let rawHash: String
    if let dg1Body = dg1Raw?.body {
      let hash = SHA256.hash(data: Data(dg1Body))
      rawHash = hash.map { String(format: "%02x", $0) }.joined()
    } else {
      let hash = SHA256.hash(data: Data(mrzData.utf8))
      rawHash = hash.map { String(format: "%02x", $0) }.joined()
    }

    return NFCReadResult(
      chipUID: chipUID,
      dg1MRZData: mrzData,
      bacSucceeded: bacOK,
      paceSucceeded: paceOK,
      passiveAuthPassed: passiveOK,
      rawDataHash: rawHash,
      readAt: Date()
    )
  }
  #endif
}
