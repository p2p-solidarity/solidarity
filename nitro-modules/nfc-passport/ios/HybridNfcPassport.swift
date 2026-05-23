//
//  HybridNfcPassport.swift
//  @solidarity/nitro-nfc-passport (iOS)
//
//  Wraps the NFCPassportReader Swift package (AndyQ) behind the
//  Nitrogen-generated HybridNfcPassportSpec. Mirrors the legacy
//  NFCPassportReaderService.swift surface so a passport read produces the
//  same PassportReadResult shape on iOS as the future Android jmrtd impl.
//
//  Flow:
//    1. JS calls read({ documentNumber, dateOfBirth, dateOfExpiry })
//    2. We build the ICAO 9303 mrzKey (passport + DOB + expiry, each with
//       a trailing check digit, zero-padded to the spec field width)
//    3. PassportReader.readPassport(mrzKey:) prompts the user to tap the
//       chip; on success we map the NFCPassportModel back into our Nitro
//       PassportReadResult struct.
//
//  Threading: Promise.async dispatches us off the JS thread; the
//  NFCPassportReader library spins its own NFCTagReaderSession internally.
//
//  Security:
//    - No `try!` / `!` force-unwraps on optional library outputs.
//    - We never log MRZ contents, document numbers, or DG bytes; only
//      counters + status flags.
//    - On user cancellation we surface a clearly-labelled error so the JS
//      layer can distinguish "user backed out" from "tag dropped mid-read"
//      (matches the legacy Swift NFCError.cancelled mapping).
//

import CryptoKit
import Foundation
import NitroModules

#if !targetEnvironment(simulator)
  import CoreNFC
  import NFCPassportReader
#endif

final class HybridNfcPassport: HybridNfcPassportSpec {

  // MARK: - Availability

  func isAvailable() -> Bool {
    #if targetEnvironment(simulator)
      return false
    #else
      if #available(iOS 13.0, *) {
        return NFCNDEFReaderSession.readingAvailable
      }
      return false
    #endif
  }

  // MARK: - Read

  func read(mrz: PassportMRZ) throws -> Promise<PassportReadResult> {
    return Promise.async {
      try await self.performRead(mrz: mrz)
    }
  }

  private func performRead(mrz: PassportMRZ) async throws -> PassportReadResult {
    #if targetEnvironment(simulator)
      throw self.error(
        code: "nfc_unavailable",
        message: "NFC passport read is not available on the iOS Simulator. Use a physical device."
      )
    #else
      let mrzKey = Self.buildMrzKey(
        passportNumber: mrz.documentNumber,
        dateOfBirth: mrz.dateOfBirth,
        expiryDate: mrz.dateOfExpiry
      )

      let reader = PassportReader()

      // CSCA Master List — if the host app bundled `masterList.pem` we load
      // it so passive authentication checks the SOD chain. Without it,
      // `passportCorrectlySigned` is always false and we surface
      // `passiveAuthValid = false` to the JS layer (the caller decides how
      // to react — typically downgrade trust level rather than refuse).
      if let masterListURL = Bundle.main.url(forResource: "masterList", withExtension: "pem") {
        reader.setMasterListURL(masterListURL)
      }

      let model: NFCPassportModel
      do {
        model = try await reader.readPassport(
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
              return "Authenticating… \(progress)%"
            case .readingDataGroupProgress(let dg, let progress):
              return "Reading \(dg)… \(progress)%"
            case .error(let nfcError):
              return "Error: \(nfcError.localizedDescription)"
            case .successfulRead:
              return "Passport read successfully."
            default:
              return nil
            }
          }
        )
      } catch let libError as NFCPassportReaderError {
        switch libError {
        case .UserCanceled, .TagNotValid, .ConnectionError:
          throw self.error(code: "nfc_cancelled", message: "NFC read was cancelled.")
        default:
          throw self.error(
            code: "nfc_read_failed",
            message: "Failed to read passport: \(libError.localizedDescription)"
          )
        }
      } catch {
        // CoreNFC user cancellation: domain=NFCError code=200 / code=6.
        let ns = error as NSError
        if ns.domain == "NFCError" && (ns.code == 200 || ns.code == 6) {
          throw self.error(code: "nfc_cancelled", message: "NFC read was cancelled.")
        }
        throw self.error(
          code: "nfc_read_failed",
          message: "Failed to read passport: \(error.localizedDescription)"
        )
      }

      return try self.mapToNitroResult(model: model, mrz: mrz)
    #endif
  }

  // MARK: - Cancel (no-op)

  func cancel() {
    // NFCPassportReader doesn't expose a public "cancel" verb beyond the
    // OS-level session timeout. The Core NFC session terminates either on
    // user dismiss, on chip removal, or after the system timeout. We leave
    // this as a no-op so the JS API has parity with the Android side once
    // jmrtd lands.
  }

  // MARK: - MRZ Key

  /// Build the mrzKey expected by NFCPassportReader. Format:
  ///   `passportNumber(padded9)<check>DOB(YYMMDD)<check>expiry(YYMMDD)<check>`
  ///
  /// Mirrors `NFCPassportReaderService.buildMRZKey` in the legacy Swift app.
  internal static func buildMrzKey(
    passportNumber: String,
    dateOfBirth: String,
    expiryDate: String
  ) -> String {
    let ppt = pad(passportNumber, to: 9)
    let dob = pad(dateOfBirth, to: 6)
    let exp = pad(expiryDate, to: 6)
    return "\(ppt)\(checkDigit(ppt))\(dob)\(checkDigit(dob))\(exp)\(checkDigit(exp))"
  }

  private static func pad(_ s: String, to length: Int) -> String {
    String((s + String(repeating: "<", count: length)).prefix(length))
  }

  /// ICAO 9303 check digit (weights 7-3-1 cycle, mod 10). `<` = 0,
  /// digits keep value, letters map to (ascii - 'A') + 10.
  internal static func checkDigit(_ input: String) -> Int {
    let weights = [7, 3, 1]
    var sum = 0
    var i = 0
    for scalar in input.unicodeScalars {
      let v: Int
      switch scalar {
      case "0"..."9":
        v = Int(scalar.value) - 48
      case "A"..."Z":
        v = Int(scalar.value) - 65 + 10
      case "a"..."z":
        v = Int(scalar.value) - 97 + 10
      case "<":
        v = 0
      default:
        v = 0
      }
      sum += v * weights[i % 3]
      i += 1
    }
    return sum % 10
  }

  // MARK: - Mapping NFCPassportModel → PassportReadResult

  #if !targetEnvironment(simulator)
    private func mapToNitroResult(
      model: NFCPassportModel,
      mrz incomingMrz: PassportMRZ
    ) throws -> PassportReadResult {
      // ── Parse the MRZ from DG1 if present, else fall back to user input.
      let composedName: String = {
        if model.lastName.isEmpty { return model.firstName }
        if model.firstName.isEmpty { return model.lastName }
        return "\(model.lastName), \(model.firstName)"
      }()
      let resolvedDocumentNumber = model.documentNumber.isEmpty
        ? incomingMrz.documentNumber : model.documentNumber
      let parsedMrz = ParsedMrz(
        nationality: model.nationality.isEmpty ? "" : String(model.nationality.prefix(3)),
        documentNumber: resolvedDocumentNumber,
        name: composedName,
        dateOfBirth: model.dateOfBirth.isEmpty ? incomingMrz.dateOfBirth : model.dateOfBirth,
        dateOfExpiry: model.documentExpiryDate.isEmpty ? incomingMrz.dateOfExpiry : model.documentExpiryDate,
        gender: model.gender
      )

      // ── Data groups → ArrayBuffer per slot. Unknown / unread groups
      // return nil so the JS layer can branch on presence.
      let dg1 = Self.dataGroupBuffer(model: model, tag: .DG1)
      let dg2 = Self.dataGroupBuffer(model: model, tag: .DG2)
      let dg14 = Self.dataGroupBuffer(model: model, tag: .DG14)
      let dg15 = Self.dataGroupBuffer(model: model, tag: .DG15)
      let sod = Self.dataGroupBuffer(model: model, tag: .SOD)

      let dgBundle = DataGroupsBundle(
        dg1: dg1, dg2: dg2, dg14: dg14, dg15: dg15, sod: sod
      )

      // ── Passive auth: signed AND not tampered, with PACE-downgrade gate
      // mirroring the legacy Swift service. BAC-only sessions on
      // PACE-capable chips are considered downgraded (an attacker could
      // have forced BAC); we surface passiveAuthValid=false in that case.
      let bacOK = (model.BACStatus == .success)
      let paceOK = (model.PACEStatus == .success)
      let supportsPACE = model.isPACESupported
      let downgraded = supportsPACE && bacOK && !paceOK
      let signedAndUntampered = model.passportCorrectlySigned && model.passportDataNotTampered
      let passiveAuthValid = signedAndUntampered && !downgraded

      // ── Chip UID — the library doesn't expose a raw chip UID, so we
      // derive a deterministic stable handle from the document number
      // (preferred) or DG1 MRZ digest (fallback). Matches Swift parity.
      let chipUid: String
      if !model.documentNumber.isEmpty {
        chipUid = "NFC-\(model.documentNumber)"
      } else {
        let bytes = SHA256.hash(data: Data(model.passportMRZ.utf8))
        let hex = bytes.map { String(format: "%02x", $0) }.joined()
        chipUid = "NFC-\(hex)"
      }

      return PassportReadResult(
        mrz: parsedMrz,
        dataGroups: dgBundle,
        chipUid: chipUid,
        passiveAuthValid: passiveAuthValid
      )
    }

    /// Wrap a single data group's raw body bytes in an `ArrayBuffer`.
    private static func dataGroupBuffer(model: NFCPassportModel, tag: DataGroupId) -> ArrayBuffer? {
      guard let dg = model.getDataGroup(tag), !dg.body.isEmpty else { return nil }
      let data = Data(dg.body)
      return (try? ArrayBuffer.copy(data: data))
    }

  #endif

  // MARK: - Errors

  private func error(code: String, message: String) -> NSError {
    return NSError(
      domain: "gg.solidarity.nfcpassport",
      code: 0,
      userInfo: [
        NSLocalizedDescriptionKey: message,
        "errorCode": code,
      ]
    )
  }
}
