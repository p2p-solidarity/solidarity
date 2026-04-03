//
//  VCService+JWT.swift
//  solidarity
//
//  JWT decoding helpers for VCService.
import Foundation

// MARK: - JWT decoding helpers

extension VCService {
  struct DecodedJWT {
    let header: [String: Any]
    let payload: [String: Any]
    let payloadData: Data
  }

  func decodeJWT(_ jwt: String) -> CardResult<DecodedJWT> {
    let components = jwt.split(separator: ".")
    guard components.count >= 2 else {
      Self.logger.error("Malformed JWT - component count: \(components.count), expected at least 2")
      return .failure(.invalidData("Malformed JWT"))
    }

    guard let headerData = Data(base64URLEncoded: String(components[0])),
      let payloadData = Data(base64URLEncoded: String(components[1]))
    else {
      Self.logger.error("Failed to decode JWT segments from base64URL")
      return .failure(.invalidData("Failed to decode JWT segments"))
    }

    do {
      let headerJSON = try JSONSerialization.jsonObject(with: headerData, options: [])
      let payloadJSON = try JSONSerialization.jsonObject(with: payloadData, options: [])

      guard let headerDict = headerJSON as? [String: Any],
        let payloadDict = payloadJSON as? [String: Any]
      else {
        Self.logger.error("JWT segments are not valid JSON objects")
        return .failure(.invalidData("JWT segments are not valid JSON objects"))
      }

      Self.logger.debug("JWT decoded successfully - header keys: \(headerDict.keys.joined(separator: ", "))")
      return .success(DecodedJWT(header: headerDict, payload: payloadDict, payloadData: payloadData))
    } catch {
      Self.logger.error("Failed to parse JWT JSON: \(error.localizedDescription)")
      return .failure(.invalidData("Failed to parse JWT JSON: \(error.localizedDescription)"))
    }
  }
}
