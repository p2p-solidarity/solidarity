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
  let userPinRequired: Bool
  /// Endpoints discovered from `/.well-known/openid-credential-issuer` (and
  /// its authorization server metadata, if advertised). Nil until metadata
  /// has been resolved; callers fall back to the legacy guessed paths only
  /// when discovery fails.
  var resolvedMetadata: IssuerMetadata?

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

/// Endpoints and capabilities advertised by an OID4VCI issuer.
struct IssuerMetadata: Equatable {
  let credentialEndpoint: URL
  let tokenEndpoint: URL
  let authorizationServer: URL?
}

/// Response from the issuer's token endpoint.
struct VCITokenResponse: Decodable {
  let accessToken: String
  let tokenType: String
  let expiresIn: Int?
  let cNonce: String?
  let cNonceExpiresIn: Int?

  enum CodingKeys: String, CodingKey {
    case accessToken = "access_token"
    case tokenType = "token_type"
    case expiresIn = "expires_in"
    case cNonce = "c_nonce"
    case cNonceExpiresIn = "c_nonce_expires_in"
  }
}

/// Response from the issuer's credential endpoint.
struct CredentialResponse: Decodable {
  let credential: String?
  let format: String?
  let cNonce: String?
  let cNonceExpiresIn: Int?
  let notificationId: String?

  enum CodingKeys: String, CodingKey {
    case credential
    case format
    case cNonce = "c_nonce"
    case cNonceExpiresIn = "c_nonce_expires_in"
    case notificationId = "notification_id"
  }
}

/// Aggregated result of a successful credential issuance.
struct IssuanceResult {
  let credentialJWT: String
  let format: String
  let issuer: String
  let credentialType: String
}
