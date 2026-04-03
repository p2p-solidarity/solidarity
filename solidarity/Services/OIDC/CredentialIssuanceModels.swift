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

  var metadataURL: URL? {
    URL(string: "\(credentialIssuer)/.well-known/openid-credential-issuer")
  }

  var tokenEndpoint: URL? {
    URL(string: "\(credentialIssuer)/token")
  }

  var credentialEndpoint: URL? {
    URL(string: "\(credentialIssuer)/credential")
  }
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
