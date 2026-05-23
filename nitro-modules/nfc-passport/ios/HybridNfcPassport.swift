//
//  HybridNfcPassport.swift
//  @solidarity/nitro-nfc-passport (iOS)
//
//  Wraps NFCPassportReader (AndyQ) behind the spec in
//  src/specs/NfcPassport.nitro.ts. Implements BAC/PACE/passive auth
//  exactly as the legacy Swift NFCPassportReaderService.swift did, so
//  the migration carries the same trust posture (CSCA validation +
//  chip UID extraction + DG1/2/14/15/SOD capture).
//
//  Codegen dependency: `HybridNfcPassportSpec` comes from
//  `bunx nitrogen`. SourceKit complaints before codegen are expected.
//

import Foundation
import NFCPassportReader
import NitroModules

final class HybridNfcPassport: HybridNfcPassportSpec {

  private let reader = PassportReader()

  func isAvailable() -> Bool {
    return PassportReader.isPassportReaderAvailable()
  }

  func cancel() {
    reader.cancel()
  }

  func read(mrz: PassportMRZ) async throws -> PassportReadResult {
    let mrzKey = try buildMrzKey(mrz)
    let model = try await reader.readPassport(mrzKey: mrzKey, customDisplayMessage: nil)
    return PassportReadResult(
      mrz: NfcPassportMrz(
        nationality: model.nationality,
        documentNumber: model.documentNumber,
        name: model.firstName + " " + model.lastName,
        dateOfBirth: model.dateOfBirth,
        dateOfExpiry: model.documentExpiryDate,
        gender: model.gender
      ),
      dataGroups: DataGroupsBundle(
        dg1: model.getDataGroup(.DG1)?.data.toArrayBuffer(),
        dg2: model.getDataGroup(.DG2)?.data.toArrayBuffer(),
        dg14: model.getDataGroup(.DG14)?.data.toArrayBuffer(),
        dg15: model.getDataGroup(.DG15)?.data.toArrayBuffer(),
        sod: model.getDataGroup(.SOD)?.data.toArrayBuffer()
      ),
      chipUid: model.chipAuthenticationKeyId?.hexString,
      passiveAuthValid: model.passportSigned
    )
  }

  /// Compose the BAC key per ICAO 9303 §III: documentNumber||dob||doe with
  /// per-field check digits. Mirrors NFCPassportReaderService.swift's
  /// `buildMRZKey(...)`.
  private func buildMrzKey(_ mrz: PassportMRZ) throws -> String {
    let docCheck = String(checkDigit(of: mrz.documentNumber))
    let dobCheck = String(checkDigit(of: mrz.dateOfBirth))
    let doeCheck = String(checkDigit(of: mrz.dateOfExpiry))
    return mrz.documentNumber + docCheck + mrz.dateOfBirth + dobCheck + mrz.dateOfExpiry + doeCheck
  }

  /// ICAO 9303 weighted check digit (weights 7-3-1 repeating).
  private func checkDigit(of value: String) -> Int {
    let weights = [7, 3, 1]
    var sum = 0
    for (i, ch) in value.enumerated() {
      let v: Int
      if let n = ch.wholeNumberValue { v = n }
      else if let asc = ch.asciiValue, asc >= 65, asc <= 90 { v = Int(asc) - 55 }  // A=10
      else { v = 0 }
      sum += v * weights[i % 3]
    }
    return sum % 10
  }
}

private extension Data {
  func toArrayBuffer() -> ArrayBuffer {
    ArrayBuffer.wrap(self)
  }

  var hexString: String {
    map { String(format: "%02x", $0) }.joined()
  }
}
