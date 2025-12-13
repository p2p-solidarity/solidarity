//
//  BiometricSigningKey.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import CryptoKit
import Foundation
import Security
import SpruceIDMobileSdkRs

/// Minimal JSON Web Key representation for EC P-256 keys.
struct PublicKeyJWK: Codable, Equatable {
  let kty: String
  let crv: String
  let alg: String
  let x: String
  let y: String

  func jsonData(prettyPrinted: Bool = false) throws -> Data {
    let encoder = JSONEncoder()
    if prettyPrinted {
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    } else {
      encoder.outputFormatting = [.sortedKeys]
    }
    return try encoder.encode(self)
  }

  func jsonString(prettyPrinted: Bool = false) throws -> String {
    let data = try jsonData(prettyPrinted: prettyPrinted)
    guard let string = String(data: data, encoding: .utf8) else {
      throw CardError.keyManagementError("Unable to encode JWK string")
    }
    return string
  }

  func x963Representation() throws -> Data {
    guard let xData = Data(base64URLEncoded: x),
      let yData = Data(base64URLEncoded: y)
    else {
      throw CardError.invalidData("Invalid public key encoding")
    }

    var buffer = Data([0x04])
    buffer.append(xData)
    buffer.append(yData)
    return buffer
  }

  func toP256PublicKey() throws -> P256.Signing.PublicKey {
    let data = try x963Representation()
    return try P256.Signing.PublicKey(x963Representation: data)
  }
}

/// Signing key implementation compatible with SpruceKit.
final class BiometricSigningKey: SpruceIDMobileSdkRs.SigningKey, @unchecked Sendable {
  private let privateKey: SecKey
  private let jwkRepresentation: PublicKeyJWK
  private let alias: KeyAlias

  init(privateKey: SecKey, jwk: PublicKeyJWK, alias: KeyAlias) {
    self.privateKey = privateKey
    self.jwkRepresentation = jwk
    self.alias = alias
  }

  func jwk() throws -> String {
    return try jwkRepresentation.jsonString()
  }

  func sign(payload: Data) throws -> Data {
    var error: Unmanaged<CFError>?
    guard
      let signature = SecKeyCreateSignature(
        privateKey,
        .ecdsaSignatureMessageX962SHA256,
        payload as CFData,
        &error
      ) as Data?
    else {
      let cfError = error?.takeRetainedValue()
      let message = (cfError as Error?)?.localizedDescription ?? "Unknown signing error"
      throw CardError.keyManagementError("Failed to sign payload: \(message)")
    }

    guard let normalized = CryptoCurveUtils.secp256r1().ensureRawFixedWidthSignatureEncoding(bytes: signature) else {
      throw CardError.keyManagementError("Unable to normalise signature for alias \(alias)")
    }

    return normalized
  }
}
