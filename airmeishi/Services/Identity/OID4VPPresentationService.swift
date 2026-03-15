import Foundation
import LocalAuthentication

protocol OID4VPKeyMaterialProviding {
  func descriptor(for relyingPartyDomain: String?, context: LAContext?) -> CardResult<DIDDescriptor>
  func signingKey(for relyingPartyDomain: String?, context: LAContext?) -> CardResult<BiometricSigningKey>
}

private struct OID4VPDefaultKeyProvider: OID4VPKeyMaterialProviding {
  private let didService = DIDService()
  private let keychain = KeychainService.shared

  func descriptor(for relyingPartyDomain: String?, context: LAContext?) -> CardResult<DIDDescriptor> {
    didService.currentDescriptor(for: relyingPartyDomain, context: context)
  }

  func signingKey(for relyingPartyDomain: String?, context: LAContext?) -> CardResult<BiometricSigningKey> {
    if let relyingPartyDomain {
      return keychain.pairwiseSigningKey(for: relyingPartyDomain, context: context)
    }
    return keychain.signingKey(context: context)
  }
}

final class OID4VPPresentationService {
  static let shared = OID4VPPresentationService()

  struct WrapOptions {
    var relyingPartyDomain: String?
    var nonce: String?
    var audience: String?
    var authenticationContext: LAContext?
    var validitySeconds: TimeInterval = 300
  }

  private let keyProvider: OID4VPKeyMaterialProviding

  init(keyProvider: OID4VPKeyMaterialProviding = OID4VPDefaultKeyProvider()) {
    self.keyProvider = keyProvider
  }

  func wrapCredentialAsVP(vcJwt: String, options: WrapOptions = WrapOptions()) -> CardResult<String> {
    let normalizedCredential = vcJwt.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedCredential.isEmpty else {
      return .failure(.invalidData("Cannot wrap empty VC JWT"))
    }

    let descriptorResult = keyProvider.descriptor(
      for: options.relyingPartyDomain,
      context: options.authenticationContext
    )
    guard case .success(let descriptor) = descriptorResult else {
      if case .failure(let error) = descriptorResult { return .failure(error) }
      return .failure(.keyManagementError("Failed to resolve DID descriptor"))
    }

    let signingKeyResult = keyProvider.signingKey(
      for: options.relyingPartyDomain,
      context: options.authenticationContext
    )
    guard case .success(let signingKey) = signingKeyResult else {
      if case .failure(let error) = signingKeyResult { return .failure(error) }
      return .failure(.keyManagementError("Failed to resolve signing key"))
    }

    let now = Date()
    var payload: [String: Any] = [
      "iss": descriptor.did,
      "iat": Int(now.timeIntervalSince1970),
      "exp": Int(now.addingTimeInterval(options.validitySeconds).timeIntervalSince1970),
      "vp": [
        "@context": ["https://www.w3.org/2018/credentials/v1"],
        "type": ["VerifiablePresentation"],
        "holder": descriptor.did,
        "verifiableCredential": [normalizedCredential],
      ] as [String: Any],
    ]
    if let nonce = options.nonce, !nonce.isEmpty { payload["nonce"] = nonce }
    if let audience = options.audience, !audience.isEmpty { payload["aud"] = audience }

    let header: [String: Any] = [
      "alg": "ES256",
      "typ": "JWT",
      "kid": descriptor.verificationMethodId,
    ]

    guard
      let headerData = try? JSONSerialization.data(withJSONObject: header, options: [.sortedKeys]),
      let payloadData = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
    else {
      return .failure(.invalidData("Failed to encode VP JWT payload"))
    }

    let headerB64 = headerData.base64URLEncodedString()
    let payloadB64 = payloadData.base64URLEncodedString()
    let signingInput = "\(headerB64).\(payloadB64)"
    guard let signingInputData = signingInput.data(using: .utf8) else {
      return .failure(.invalidData("Failed to encode VP signing input"))
    }

    do {
      let signature = try signingKey.sign(payload: signingInputData).base64URLEncodedString()
      return .success("\(signingInput).\(signature)")
    } catch let error as CardError {
      return .failure(error)
    } catch {
      return .failure(.cryptographicError("Failed to sign VP token: \(error.localizedDescription)"))
    }
  }
}
