//
//  HybridNfcPassport.swift
//  @solidarity/nitro-nfc-passport (iOS)
//
//  Wraps the NFCPassportReader SPM package (AndyQ) behind the
//  Nitrogen-generated HybridNfcPassportSpec protocol. Reads BAC/PACE/passive
//  auth-protected DG1, DG2, DG14, DG15, and SOD from an ICAO 9303 e-passport.
//
//  Stubbed today — link NFCPassportReader via the autolinked .podspec and
//  port NFCPassportReaderService.swift's read logic in.
//
import Foundation
import NitroModules

final class HybridNfcPassport: HybridNfcPassportSpec {

  func isAvailable() -> Bool {
    if #available(iOS 13.0, *) { return true }
    return false
  }

  func read(mrz: PassportMRZ) throws -> Promise<PassportReadResult> {
    return Promise.async {
      throw NSError(domain: "NfcPassport", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "NFC passport read not linked yet — pod install NFCPassportReader"
      ])
    }
  }

  func cancel() { /* no-op stub */ }
}
