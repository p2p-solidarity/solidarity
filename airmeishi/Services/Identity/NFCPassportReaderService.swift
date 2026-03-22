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
  /// Delegates to the shared implementation in MRZScannerService.
  static func checkDigit(_ input: String) -> Int {
    MRZScannerService.computeCheckDigit(input)
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
    if let masterListURL = Bundle.main.url(forResource: "masterList", withExtension: "pem") {
      reader.setMasterListURL(masterListURL)
    }

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
    } catch let nfcError as NFCPassportReaderError {
      switch nfcError {
      case .UserCanceled, .TagNotValid, .ConnectionError:
        throw NFCError.cancelled
      default:
        throw NFCError.readFailed(nfcError.localizedDescription)
      }
    } catch {
      let nsError = error as NSError
      // CoreNFC user cancellation: domain=NFCError code=200 or code=6
      if nsError.domain == "NFCError" && (nsError.code == 200 || nsError.code == 6) {
        throw NFCError.cancelled
      }
      throw NFCError.readFailed(error.localizedDescription)
    }

    // Extract MRZ from DG1
    let mrzData = passport.passportMRZ

    // Determine authentication status
    let bacOK = passport.BACStatus == .success
    let paceOK = passport.PACEStatus == .success

    // Passive authentication
    let passiveOK = passport.passportCorrectlySigned && passport.passportDataNotTampered

    // Build chip UID from document number (no direct UID exposed by library)
    // Use deterministic fallback based on MRZ data to ensure stable de-duplication
    let chipUID: String
    if !passport.documentNumber.isEmpty {
      chipUID = "NFC-\(passport.documentNumber)"
    } else {
      let fallbackHash = SHA256.hash(data: Data(mrzData.utf8))
      chipUID = "NFC-\(fallbackHash.prefix(4).map { String(format: "%02x", $0) }.joined())"
    }

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
