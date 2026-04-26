import CryptoKit
import Foundation

#if !targetEnvironment(simulator)
import NFCPassportReader
#endif

// MARK: - Result type

struct NFCReadResult {
  let chipUID: String
  let dg1MRZData: String
  let bacSucceeded: Bool
  let paceSucceeded: Bool
  let passiveAuthPassed: Bool
  /// True when the chip advertised PACE capability but the session ended
  /// using BAC only. This is treated as a downgrade and forces
  /// `passiveAuthPassed` to false even if the SOD chain otherwise checks
  /// out, because BAC-only sessions on PACE-capable chips are vulnerable
  /// to active downgrade attacks.
  let paceDowngraded: Bool
  let rawDataHash: String
  let readAt: Date
}

// MARK: - Service

final class NFCPassportReaderService: NSObject {

  /// True when a CSCA Master List PEM was found in the bundle and loaded
  /// into the reader. When false, passive authentication will always
  /// return false because the document signing chain has no trust roots.
  /// Callers should not block reads on this flag, but they should refuse
  /// to mark a credential as "government" trust without it.
  ///
  /// TODO: bundle a CSCA Master List from OpenPassport (`selfxyz/self`)
  /// in PEM form (see CLAUDE.md → "CSCA Master List — Passport 驗證" for
  /// the recommended pipeline).
  private(set) var isMasterListLoaded: Bool = false

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

  #if !targetEnvironment(simulator)
  func read(passportNumber: String, dateOfBirth: String, expiryDate: String) async throws -> NFCReadResult {
    let mrzKey = NFCPassportReaderService.buildMRZKey(
      passportNumber: passportNumber,
      dateOfBirth: dateOfBirth,
      expiryDate: expiryDate
    )

    let reader = PassportReader()
    if let masterListURL = Bundle.main.url(forResource: "masterList", withExtension: "pem") {
      reader.setMasterListURL(masterListURL)
      isMasterListLoaded = true
      print("[NFCPassportReader] masterList.pem loaded — passive authentication enabled")
    } else {
      isMasterListLoaded = false
      // TODO: load CSCA Master List from OpenPassport (selfxyz/self) PEM
      // (see CLAUDE.md → "CSCA Master List — Passport 驗證").
      print("[NFCPassportReader][WARNING] masterList.pem missing — passive authentication disabled (passiveAuthPassed will always be false). Add a CSCA Master List PEM to the bundle to enable passport authenticity checks.")
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

    // PACE downgrade detection: chip advertised PACE capability (via
    // CardAccess or DG14 PACEInfo) but the session ended with BAC only.
    // BAC-only sessions on PACE-capable chips are considered downgraded
    // because an attacker between the chip and the reader can force BAC
    // selection — passive auth must be rejected in that case even if
    // the SOD chain itself verifies.
    let chipSupportsPACE = passport.isPACESupported
    let paceDowngraded = chipSupportsPACE && bacOK && !paceOK
    if !paceOK {
      print("[NFCPassportReader] PACE not completed — bacOK=\(bacOK), chipSupportsPACE=\(chipSupportsPACE), downgraded=\(paceDowngraded)")
    }

    // Passive authentication. We additionally gate on PACE downgrade —
    // a downgraded session is rejected even if SOD/DSC checks pass.
    let signedAndUntampered = passport.passportCorrectlySigned && passport.passportDataNotTampered
    let passiveOK = signedAndUntampered && !paceDowngraded
    if signedAndUntampered && paceDowngraded {
      print("[NFCPassportReader][WARNING] Passive auth FORCED to false because PACE was downgraded to BAC")
    }

    // Build chip UID from document number (no direct UID exposed by library)
    // Use deterministic fallback based on MRZ data to ensure stable de-duplication.
    // Full SHA-256 hex prevents 32-bit collisions while staying deterministic per passport.
    let chipUID: String
    if !passport.documentNumber.isEmpty {
      chipUID = "NFC-\(passport.documentNumber)"
    } else {
      let fallbackHash = SHA256.hash(data: Data(mrzData.utf8))
      let fullHashHex = fallbackHash.map { String(format: "%02x", $0) }.joined()
      chipUID = "NFC-\(fullHashHex)"
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
      paceDowngraded: paceDowngraded,
      rawDataHash: rawHash,
      readAt: Date()
    )
  }
  #else
  func read(passportNumber _: String, dateOfBirth _: String, expiryDate _: String) async throws -> NFCReadResult {
    print("[PassportPipeline] NFC reading is not available on simulator")
    throw NFCError.notAvailable
  }
  #endif
}
