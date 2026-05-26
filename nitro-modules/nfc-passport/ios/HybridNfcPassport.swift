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

// NFCPassportReader (AndyQ) pulls OpenSSL-Universal 3.3.x, whose headers
// break Xcode 26's strict Clang module build with "@import inside extern \"C\"".
// Until that's resolved upstream, iOS passport NFC is stubbed: we drop the
// pod dependency in NfcPassport.podspec and gate all NFCPassportReader use
// behind `canImport(NFCPassportReader)`, which yields false when the pod
// isn't present. Android jmrtd remains the production NFC path.
#if canImport(NFCPassportReader) && !targetEnvironment(simulator)
  import CoreNFC
  import NFCPassportReader
#endif

final class HybridNfcPassport: HybridNfcPassportSpec {

  // MARK: - Availability

  func isAvailable() -> Bool {
    #if canImport(NFCPassportReader) && !targetEnvironment(simulator)
      if #available(iOS 13.0, *) {
        return NFCNDEFReaderSession.readingAvailable
      }
    #endif
    return false
  }

  // MARK: - Read

  func read(mrz: PassportMRZ, options: NfcReadOptions?) throws -> Promise<PassportReadResult> {
    return Promise.async {
      try await self.performRead(mrz: mrz, options: options)
    }
  }

  private func performRead(
    mrz: PassportMRZ,
    options: NfcReadOptions?
  ) async throws -> PassportReadResult {
    #if !canImport(NFCPassportReader)
      throw self.error(
        code: "nfc_unavailable",
        message: "iOS NFC passport read is disabled in this build. Use Android."
      )
    #elseif targetEnvironment(simulator)
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

      // CSCA Master List — if the bundle ships `masterList.pem` we load it
      // so passive authentication checks the SOD chain. Without it,
      // `passportCorrectlySigned` is always false and we surface
      // `passiveAuthValid = false` to the JS layer (the caller decides how
      // to react — typically downgrade trust level rather than refuse).
      //
      // Look in both the module's own bundle (when the file ships inside a
      // CocoaPods resource bundle) AND the host app's main bundle (when the
      // pod adds it via `s.resources` and CocoaPods copies it straight into
      // the main bundle). This is defensive so swapping between
      // `s.resources` and `s.resource_bundles` later doesn't break runtime
      // lookup.
      if let masterListURL = Self.locateMasterList() {
        reader.setMasterListURL(masterListURL)
      }

      // Build the data-group request list. DG2 (face JPEG) is the slowest
      // ~3-5 sec piece of the read; the JS pipeline only uses DG1 today so
      // the Expo flow passes `skipFaceImage: true` to cut total read time
      // in half. Leave DG2 in by default so existing callers (none yet,
      // but the Swift-app parity tests) don't silently lose the image.
      let skipFace = options?.skipFaceImage ?? false
      var tags: [DataGroupId] = [.COM, .SOD, .DG1, .DG14, .DG15]
      if !skipFace {
        tags.insert(.DG2, at: 3)
      }

      // Forward NFCPassportReader's progress dispatch (the same hook that
      // drives the system NFC sheet text) to the JS callback so the app
      // can paint a real progress bar. Returning the display string from
      // the closure is what populates the Core NFC sheet — preserve that
      // exact mapping for parity with the Swift app.
      let onProgress = options?.onProgress
      let displayMessageHandler: (NFCViewDisplayMessage) -> String? = { message in
        switch message {
        case .requestPresentPassport:
          onProgress?(NfcReadProgress(
            phase: .connecting,
            percent: 0,
            dataGroup: nil,
            message: "Hold your passport against the back of your iPhone."
          ))
          return "Hold your passport against the back of your iPhone."
        case .authenticatingWithPassport(let progress):
          // Auth covers BAC+PACE — give it the 0..30% range.
          let pct = min(30.0, Double(progress) * 0.30)
          onProgress?(NfcReadProgress(
            phase: .authenticating,
            percent: pct,
            dataGroup: nil,
            message: "Authenticating… \(progress)%"
          ))
          return "Authenticating… \(progress)%"
        case .readingDataGroupProgress(let dg, let progress):
          // DG read covers 30..95%. The library doesn't tell us which DG
          // index we're on relative to the total — just report the local
          // %% for this DG and rely on the JS side to coarse-bucket.
          let pct = 30.0 + (min(100.0, Double(progress)) * 0.65)
          onProgress?(NfcReadProgress(
            phase: .readingDg,
            percent: pct,
            dataGroup: "\(dg)",
            message: "Reading \(dg)… \(progress)%"
          ))
          return "Reading \(dg)… \(progress)%"
        case .error(let nfcError):
          onProgress?(NfcReadProgress(
            phase: .error,
            percent: 0,
            dataGroup: nil,
            message: nfcError.localizedDescription
          ))
          return "Error: \(nfcError.localizedDescription)"
        case .successfulRead:
          onProgress?(NfcReadProgress(
            phase: .done,
            percent: 100,
            dataGroup: nil,
            message: "Passport read successfully."
          ))
          return "Passport read successfully."
        default:
          return nil
        }
      }

      let model: NFCPassportModel
      do {
        model = try await reader.readPassport(
          mrzKey: mrzKey,
          tags: tags,
          skipSecureElements: false,
          skipCA: false,
          skipPACE: false,
          customDisplayMessage: displayMessageHandler
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

  // MARK: - Bundle resource lookup

  /// Resolve the `masterList.pem` URL. Checks (in order):
  ///   1. The Nitro module's own `Bundle(for: HybridNfcPassport.self)` —
  ///      where it lands when packaged via `s.resource_bundles`.
  ///   2. The host app's `Bundle.main` — where it lands when packaged via
  ///      `s.resources` (current podspec wiring) or when the Swift host
  ///      app added it directly to its iOS target.
  ///   3. Common pod resource bundle names under `Bundle.main` — Xcode
  ///      sometimes places sub-bundles inside `.app` even with `s.resources`.
  ///
  /// Returns nil if no PEM is bundled. The caller surfaces
  /// `passiveAuthValid = false` in that case rather than failing the read.
  internal static func locateMasterList() -> URL? {
    let moduleBundle = Bundle(for: HybridNfcPassport.self)
    if let url = moduleBundle.url(forResource: "masterList", withExtension: "pem") {
      return url
    }
    if let url = Bundle.main.url(forResource: "masterList", withExtension: "pem") {
      return url
    }
    for sub in ["NfcPassportResources", "NfcPassport"] {
      if let url = Bundle.main.url(
        forResource: "masterList",
        withExtension: "pem",
        subdirectory: "\(sub).bundle"
      ) {
        return url
      }
    }
    return nil
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

  #if canImport(NFCPassportReader) && !targetEnvironment(simulator)
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

    /// Wrap a single data group's raw TLV bytes in an `ArrayBuffer`. We use
    /// `dg.data` (the full DataGroup TLV) rather than `dg.body` (inner
    /// content) because:
    ///   - The SOD hashes are computed over `dg.data`, so downstream passive-
    ///     auth checks and ZK circuits that re-hash the DGs see the same
    ///     bytes regardless of platform.
    ///   - Android jmrtd surfaces the full encoded DG bytes, so emitting the
    ///     TLV here keeps the JS-facing payload identical across platforms.
    private static func dataGroupBuffer(model: NFCPassportModel, tag: DataGroupId) -> ArrayBuffer? {
      guard let dg = model.getDataGroup(tag), !dg.data.isEmpty else { return nil }
      let data = Data(dg.data)
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
