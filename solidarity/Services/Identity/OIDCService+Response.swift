//
//  OIDCService+Response.swift
//  solidarity
//
//  Holder-side response signing for OID4VP / SIOPv2.
//
//  Covers two response shapes that were previously unimplemented:
//    1. SIOPv2 self-issued `id_token` responses — the holder signs an
//       id_token whose issuer is the magic value `https://self-issued.me/v2`
//       and whose `sub_jwk` proves control of the presented DID.
//    2. `direct_post.jwt` (JARM-style) — the vp_token + state are wrapped
//       in a signed JWT and POSTed as `response=<jwt>` to the verifier's
//       response_uri, per OID4VP 1.0 §6.2.
//
//  Both paths share the same pairwise signing key used elsewhere so the
//  holder's responses stay DID-bound without new key material.
//

import CryptoKit
import Foundation
import LocalAuthentication
import UIKit

extension OIDCService {

  /// Bundles the signer identity and target audience that JARM-style and
  /// SIOPv2 responses need to embed into the issued JWT. Reduces the
  /// parameter footprint of `submitFormResponse` / JARM helpers.
  struct ResponseSignerContext {
    let descriptor: DIDDescriptor
    let signingKey: BiometricSigningKey
    let audience: String
  }

  // MARK: - SIOPv2 id_token submission

  /// Signs and submits a SIOPv2 self-issued id_token. The caller must have
  /// already gated on biometric / user consent — this function only drives
  /// the crypto + transport and returns the encoded id_token on success.
  func submitIdToken(
    request: PresentationRequest,
    context: LAContext? = nil
  ) async -> CardResult<String> {
    let keychain = KeychainService.shared
    let rpDomain = URL(string: request.effectiveResponseTarget)?.host

    let descriptorResult = DIDService().currentDescriptor(for: rpDomain, context: context)
    guard case .success(let descriptor) = descriptorResult else {
      if case .failure(let error) = descriptorResult { return .failure(error) }
      return .failure(.keyManagementError("Failed to resolve DID for id_token"))
    }

    let signerResult: CardResult<BiometricSigningKey>
    if let rpDomain {
      signerResult = keychain.pairwiseSigningKey(for: rpDomain, context: context)
    } else {
      signerResult = keychain.signingKey(context: context)
    }
    guard case .success(let signingKey) = signerResult else {
      if case .failure(let error) = signerResult { return .failure(error) }
      return .failure(.keyManagementError("Failed to resolve signing key for id_token"))
    }

    let idTokenResult = buildSIOPIdToken(
      descriptor: descriptor,
      signingKey: signingKey,
      request: request
    )
    guard case .success(let idToken) = idTokenResult else {
      if case .failure(let error) = idTokenResult { return .failure(error) }
      return .failure(.cryptographicError("Failed to build id_token"))
    }

    // Fragment / query response modes still redirect; direct_post family
    // POSTs to response_uri (potentially wrapped as JARM below).
    let target = request.effectiveResponseTarget
    let responseMode = request.responseMode.lowercased()
    let state = request.state.isEmpty ? nil : request.state

    if responseMode.hasPrefix("direct_post") {
      let jarmMode = responseMode == "direct_post.jwt"
      let signer = ResponseSignerContext(
        descriptor: descriptor,
        signingKey: signingKey,
        audience: request.clientId
      )
      let submitResult = await submitFormResponse(
        target: target,
        fields: ["id_token": idToken],
        state: state,
        jarm: jarmMode,
        signer: signer
      )
      if case .failure(let error) = submitResult { return .failure(error) }
      return .success(idToken)
    }

    // Non-direct_post — append to redirect target and open.
    guard var components = URLComponents(string: target) else {
      return .failure(.invalidData("Invalid response target URI"))
    }
    var items = components.queryItems ?? []
    items.append(URLQueryItem(name: "id_token", value: idToken))
    if let state { items.append(URLQueryItem(name: "state", value: state)) }
    components.queryItems = items

    guard let url = components.url else {
      return .failure(.invalidData("Failed to build id_token redirect URL"))
    }

    let canOpen = await MainActor.run { UIApplication.shared.canOpenURL(url) }
    guard canOpen else {
      return .failure(.networkError("Unable to open redirect URI: \(target)"))
    }
    await MainActor.run { UIApplication.shared.open(url) }
    return .success(idToken)
  }

  /// Builds the compact-serialized SIOPv2 id_token. Header binds to the
  /// presentation's DID key; payload uses the magic SIOPv2 issuer.
  private func buildSIOPIdToken(
    descriptor: DIDDescriptor,
    signingKey: BiometricSigningKey,
    request: PresentationRequest
  ) -> CardResult<String> {
    let now = Int(Date().timeIntervalSince1970)
    let exp = now + 300

    let header: [String: Any] = [
      "alg": "ES256",
      "typ": "JWT",
      "kid": descriptor.verificationMethodId,
    ]

    // SIOPv2 §9: self-issued id_tokens carry iss/sub = the subject DID
    // (per "Self-Issued OP Response" spec rev 12 — both values are the
    // holder's DID). `sub_jwk` binds the response to the public key the
    // verifier can resolve from the DID.
    let subJwk: [String: Any] = [
      "kty": descriptor.jwk.kty,
      "crv": descriptor.jwk.crv,
      "alg": descriptor.jwk.alg,
      "x": descriptor.jwk.x,
      "y": descriptor.jwk.y,
    ]

    var payload: [String: Any] = [
      "iss": "https://self-issued.me/v2",
      "sub": descriptor.did,
      "aud": request.clientId,
      "iat": now,
      "exp": exp,
      "sub_jwk": subJwk,
    ]
    if !request.nonce.isEmpty { payload["nonce"] = request.nonce }

    return signCompactJWT(header: header, payload: payload, signingKey: signingKey)
  }

  // MARK: - direct_post.jwt (JARM) wrapping

  /// POST a form response to the verifier. When `jarm` is true, the fields
  /// are wrapped into a single signed JWT and posted as `response=<jwt>`
  /// per OID4VP 1.0 §6.2 / JARM. Otherwise fields are submitted as-is.
  private func submitFormResponse(
    target: String,
    fields: [String: String],
    state: String?,
    jarm: Bool,
    signer: ResponseSignerContext
  ) async -> CardResult<Void> {
    guard let url = URL(string: target) else {
      return .failure(.invalidData("Invalid response_uri"))
    }

    var bodyItems: [URLQueryItem] = []

    if jarm {
      var inner = fields
      if let state { inner["state"] = state }
      let jwtResult = buildJARMResponseJWT(
        fields: inner,
        signer: signer
      )
      guard case .success(let jwt) = jwtResult else {
        if case .failure(let error) = jwtResult { return .failure(error) }
        return .failure(.cryptographicError("Failed to build JARM response JWT"))
      }
      bodyItems.append(URLQueryItem(name: "response", value: jwt))
    } else {
      for (key, value) in fields {
        bodyItems.append(URLQueryItem(name: key, value: value))
      }
      if let state { bodyItems.append(URLQueryItem(name: "state", value: state)) }
    }

    var bodyComponents = URLComponents()
    bodyComponents.queryItems = bodyItems
    guard let bodyString = bodyComponents.percentEncodedQuery else {
      return .failure(.invalidData("Failed to encode response body"))
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = bodyString.data(using: .utf8)

    do {
      let (_, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
        let code = (response as? HTTPURLResponse)?.statusCode ?? -1
        return .failure(.networkError("Verifier returned HTTP \(code)"))
      }
      return .success(())
    } catch {
      return .failure(.networkError("Failed to submit response: \(error.localizedDescription)"))
    }
  }

  /// Wraps direct_post.jwt payload fields into a signed JARM JWT.
  /// typ is `oauth-authz-resp+jwt` per JARM (RFC-in-draft).
  private func buildJARMResponseJWT(
    fields: [String: String],
    signer: ResponseSignerContext
  ) -> CardResult<String> {
    let now = Int(Date().timeIntervalSince1970)
    let exp = now + 300

    let header: [String: Any] = [
      "alg": "ES256",
      "typ": "oauth-authz-resp+jwt",
      "kid": signer.descriptor.verificationMethodId,
    ]

    var payload: [String: Any] = [
      "iss": signer.descriptor.did,
      "aud": signer.audience,
      "iat": now,
      "exp": exp,
    ]
    for (key, value) in fields {
      payload[key] = value
    }

    return signCompactJWT(header: header, payload: payload, signingKey: signer.signingKey)
  }

  // MARK: - Shared signer

  private func signCompactJWT(
    header: [String: Any],
    payload: [String: Any],
    signingKey: BiometricSigningKey
  ) -> CardResult<String> {
    do {
      let headerData = try JSONSerialization.data(withJSONObject: header, options: [.sortedKeys])
      let payloadData = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])

      let headerB64 = headerData.base64URLEncodedString()
      let payloadB64 = payloadData.base64URLEncodedString()
      let signingInput = "\(headerB64).\(payloadB64)"

      guard let signingInputData = signingInput.data(using: .utf8) else {
        return .failure(.invalidData("Failed to encode JWT signing input"))
      }

      let signature = try signingKey.sign(payload: signingInputData).base64URLEncodedString()
      return .success("\(signingInput).\(signature)")
    } catch let error as CardError {
      return .failure(error)
    } catch {
      return .failure(.cryptographicError("Failed to sign JWT: \(error.localizedDescription)"))
    }
  }

  // MARK: - Enhanced vp_token submission (direct_post.jwt aware)

  /// Bundles verifier identification used when wrapping a vp_token as a
  /// JARM-style signed response. Lets the public submit API stay under the
  /// SwiftLint parameter cap without losing call-site context.
  struct VPSubmissionVerifier {
    let nonce: String?
    let audience: String
    let relyingPartyDomain: String?
    let context: LAContext?

    init(
      nonce: String?,
      audience: String,
      relyingPartyDomain: String?,
      context: LAContext? = nil
    ) {
      self.nonce = nonce
      self.audience = audience
      self.relyingPartyDomain = relyingPartyDomain
      self.context = context
    }
  }

  /// Overload of submitVpToken that knows how to wrap the token as JARM
  /// when the verifier requested `direct_post.jwt`. Falls through to the
  /// legacy direct_post form when a plain direct_post was requested.
  func submitVpToken(
    token: String,
    target: String,
    state: String?,
    responseMode: String,
    verifier: VPSubmissionVerifier
  ) async -> CardResult<Void> {
    let lowered = responseMode.lowercased()

    guard lowered == "direct_post.jwt" else {
      return await submitVpToken(
        token: token,
        target: target,
        state: state,
        responseMode: responseMode
      )
    }

    let keychain = KeychainService.shared
    let descriptorResult = DIDService().currentDescriptor(
      for: verifier.relyingPartyDomain,
      context: verifier.context
    )
    guard case .success(let descriptor) = descriptorResult else {
      if case .failure(let error) = descriptorResult { return .failure(error) }
      return .failure(.keyManagementError("Failed to resolve DID for JARM response"))
    }

    let signerResult: CardResult<BiometricSigningKey>
    if let rp = verifier.relyingPartyDomain {
      signerResult = keychain.pairwiseSigningKey(for: rp, context: verifier.context)
    } else {
      signerResult = keychain.signingKey(context: verifier.context)
    }
    guard case .success(let signingKey) = signerResult else {
      if case .failure(let error) = signerResult { return .failure(error) }
      return .failure(.keyManagementError("Failed to resolve signing key for JARM response"))
    }

    let signer = ResponseSignerContext(
      descriptor: descriptor,
      signingKey: signingKey,
      audience: verifier.audience
    )
    return await submitFormResponse(
      target: target,
      fields: ["vp_token": token],
      state: state,
      jarm: true,
      signer: signer
    )
  }
}
