//
//  CredentialIssuanceModels.swift
//  solidarity
//

import Foundation

/// Parsed credential offer from `openid-credential-offer://` URL.
struct CredentialOffer: Equatable {
  let credentialIssuer: String
  let credentialConfigurationIds: [String]
  let preAuthorizedCode: String?
  /// OID4VCI final (§4.1.1): `tx_code` object carrying length / input_mode /
  /// description. nil when the issuer does not require a transaction code.
  /// Legacy `user_pin_required: true` is upgraded to an empty spec so older
  /// issuers keep working.
  let txCode: TxCodeSpec?
  /// Endpoints discovered from `/.well-known/openid-credential-issuer` (and
  /// its authorization server metadata, if advertised). Nil until metadata
  /// has been resolved; callers fall back to the legacy guessed paths only
  /// when discovery fails.
  var resolvedMetadata: IssuerMetadata?

  /// Backwards-compatible accessor for UI that already gates on a bool.
  var userPinRequired: Bool { txCode != nil }

  var metadataURL: URL? {
    URL(string: "\(credentialIssuer)/.well-known/openid-credential-issuer")
  }

  var tokenEndpoint: URL? {
    if let endpoint = resolvedMetadata?.tokenEndpoint { return endpoint }
    return URL(string: "\(credentialIssuer)/token")
  }

  var credentialEndpoint: URL? {
    if let endpoint = resolvedMetadata?.credentialEndpoint { return endpoint }
    return URL(string: "\(credentialIssuer)/credential")
  }
}

/// OID4VCI final transaction code descriptor. Every field is optional —
/// an issuer that simply asks for "a code" sends `{}`. `inputMode` is
/// "numeric" when omitted (spec default).
struct TxCodeSpec: Equatable {
  let inputMode: String
  let length: Int?
  let description: String?

  static let `default` = TxCodeSpec(inputMode: "numeric", length: nil, description: nil)

  init(inputMode: String = "numeric", length: Int? = nil, description: String? = nil) {
    self.inputMode = inputMode
    self.length = length
    self.description = description
  }

  /// Parse the `tx_code` member of a pre-authorized_code grant. Accepts
  /// either the current object form or the draft `true` / `user_pin_required`
  /// shorthand (reported as a default spec).
  static func parse(_ value: Any?) -> TxCodeSpec? {
    if let dict = value as? [String: Any] {
      let mode = dict["input_mode"] as? String ?? "numeric"
      let length = dict["length"] as? Int
      let description = dict["description"] as? String
      return TxCodeSpec(inputMode: mode, length: length, description: description)
    }
    if let flag = value as? Bool, flag {
      return .default
    }
    return nil
  }
}

/// Endpoints and capabilities advertised by an OID4VCI issuer.
struct IssuerMetadata: Equatable {
  let credentialEndpoint: URL
  let tokenEndpoint: URL
  let authorizationServer: URL?
  /// Nonce endpoint (§7.2 of OID4VCI final) — the issuer's dedicated
  /// c_nonce source. When present, callers SHOULD fetch from here before
  /// building the proof of possession. nil when not advertised.
  let nonceEndpoint: URL?

  init(
    credentialEndpoint: URL,
    tokenEndpoint: URL,
    authorizationServer: URL?,
    nonceEndpoint: URL? = nil
  ) {
    self.credentialEndpoint = credentialEndpoint
    self.tokenEndpoint = tokenEndpoint
    self.authorizationServer = authorizationServer
    self.nonceEndpoint = nonceEndpoint
  }
}

/// Response from the issuer's token endpoint.
struct VCITokenResponse: Decodable {
  let accessToken: String
  let tokenType: String
  let expiresIn: Int?
  let cNonce: String?
  let cNonceExpiresIn: Int?
  /// OID4VCI final introduces `authorization_details` on token responses
  /// listing the specific `credential_identifier`(s) the client may request.
  /// Kept as raw JSON so we can forward without losing fidelity.
  let authorizationDetails: [[String: Any]]?

  enum CodingKeys: String, CodingKey {
    case accessToken = "access_token"
    case tokenType = "token_type"
    case expiresIn = "expires_in"
    case cNonce = "c_nonce"
    case cNonceExpiresIn = "c_nonce_expires_in"
    case authorizationDetails = "authorization_details"
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.accessToken = try container.decode(String.self, forKey: .accessToken)
    self.tokenType = try container.decode(String.self, forKey: .tokenType)
    self.expiresIn = try container.decodeIfPresent(Int.self, forKey: .expiresIn)
    self.cNonce = try container.decodeIfPresent(String.self, forKey: .cNonce)
    self.cNonceExpiresIn = try container.decodeIfPresent(Int.self, forKey: .cNonceExpiresIn)

    if let raw = try? container.decodeIfPresent([JSONAny].self, forKey: .authorizationDetails) {
      self.authorizationDetails = raw.compactMap { $0.value as? [String: Any] }
    } else {
      self.authorizationDetails = nil
    }
  }
}

/// Response from the issuer's credential endpoint. Supports both the
/// legacy single-credential form (`credential`) and the OID4VCI final
/// batch form (`credentials` array).
struct CredentialResponse: Decodable {
  /// Non-nil for legacy responses; nil for batch responses.
  let credential: String?
  let format: String?
  let cNonce: String?
  let cNonceExpiresIn: Int?
  let notificationId: String?
  /// OID4VCI final §7.3: issuers may return one or more credentials at
  /// once. Each entry is at minimum `{credential: String}` but may carry
  /// `format` and other fields.
  let credentials: [BatchEntry]?
  let transactionId: String?

  struct BatchEntry: Decodable {
    let credential: String
    let format: String?

    enum CodingKeys: String, CodingKey {
      case credential
      case format
    }
  }

  enum CodingKeys: String, CodingKey {
    case credential
    case format
    case cNonce = "c_nonce"
    case cNonceExpiresIn = "c_nonce_expires_in"
    case notificationId = "notification_id"
    case credentials
    case transactionId = "transaction_id"
  }

  /// First issued credential JWT, preferring the batch form when available.
  var primaryCredentialJWT: String? {
    if let first = credentials?.first?.credential { return first }
    return credential
  }

  /// Best-effort format hint from whichever field is populated.
  var primaryFormat: String? {
    credentials?.first?.format ?? format
  }
}

/// Aggregated result of a successful credential issuance.
struct IssuanceResult {
  let credentialJWT: String
  let format: String
  let issuer: String
  let credentialType: String
  /// Fresh c_nonce returned on the credential response (OID4VCI final
  /// §7.3). The caller MUST thread this into any follow-up credential
  /// request (batch issuance, notification correlation) — the previous
  /// proof's nonce has been consumed.
  let cNonce: String?

  init(
    credentialJWT: String,
    format: String,
    issuer: String,
    credentialType: String,
    cNonce: String? = nil
  ) {
    self.credentialJWT = credentialJWT
    self.format = format
    self.issuer = issuer
    self.credentialType = credentialType
    self.cNonce = cNonce
  }
}

/// Minimal `Decodable` wrapper used only to pass arbitrary JSON values
/// through Codable. Exposes the underlying value as `Any`.
private struct JSONAny: Decodable {
  let value: Any

  init(from decoder: Decoder) throws {
    if let container = try? decoder.container(keyedBy: AnyKey.self) {
      var dict: [String: Any] = [:]
      for key in container.allKeys {
        dict[key.stringValue] = try container.decode(JSONAny.self, forKey: key).value
      }
      self.value = dict
      return
    }
    if var container = try? decoder.unkeyedContainer() {
      var arr: [Any] = []
      while !container.isAtEnd {
        arr.append(try container.decode(JSONAny.self).value)
      }
      self.value = arr
      return
    }
    let single = try decoder.singleValueContainer()
    if let b = try? single.decode(Bool.self) { self.value = b; return }
    if let i = try? single.decode(Int.self) { self.value = i; return }
    if let d = try? single.decode(Double.self) { self.value = d; return }
    if let s = try? single.decode(String.self) { self.value = s; return }
    if single.decodeNil() { self.value = NSNull(); return }
    self.value = NSNull()
  }

  private struct AnyKey: CodingKey {
    let stringValue: String
    let intValue: Int?
    init?(stringValue: String) {
      self.stringValue = stringValue
      self.intValue = nil
    }
    init?(intValue: Int) {
      self.stringValue = String(intValue)
      self.intValue = intValue
    }
  }
}
