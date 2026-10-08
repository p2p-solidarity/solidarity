import AuthenticationServices
import CryptoKit
import Foundation
import NitroModules
import Security
import UIKit

private enum PasskeyPrfNativeError: LocalizedError {
  case unsupported
  case cancelled
  case alreadyRegistered
  case invalidInput
  case noPresentationAnchor
  case noPrf
  case invalidCredential

  var errorDescription: String? {
    switch self {
    case .unsupported: return "passkey_prf_unsupported"
    case .alreadyRegistered: return "passkey_prf_already_registered"
    case .cancelled: return "passkey_prf_cancelled"
    case .invalidInput: return "passkey_prf_invalid_input"
    case .noPresentationAnchor: return "passkey_prf_no_presentation_anchor"
    case .noPrf: return "passkey_prf_no_prf"
    case .invalidCredential: return "passkey_prf_invalid_credential"
    }
  }
}

@available(iOS 18.0, *)
@MainActor
private final class PasskeyRegistrationCoordinator: NSObject,
  ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding
{
  private let anchor: ASPresentationAnchor
  private var controller: ASAuthorizationController?
  private var continuation: CheckedContinuation<(Data, Data, String?, Data?), Error>?

  init(anchor: ASPresentationAnchor) {
    self.anchor = anchor
  }

  func perform(
    rpId: String, userName: String, userId: Data, prfInput: Data, excludeCredentialIds: [Data]
  ) async throws -> (Data, Data, String?, Data?) {
    let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
      relyingPartyIdentifier: rpId)
    let request = provider.createCredentialRegistrationRequest(
      challenge: try Self.randomBytes(count: 32), name: userName, userID: userId)
    // Declared by ASAuthorizationWebBrowserPlatformPublicKeyCredentialRegistrationRequest.
    if #available(iOS 17.4, *) {
      request.excludedCredentials = excludeCredentialIds.map {
        ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0)
      }
    }
    request.userVerificationPreference = .required
    request.prf = .inputValues(.init(saltInput1: prfInput))

    return try await withCheckedThrowingContinuation { continuation in
      self.continuation = continuation
      let controller = ASAuthorizationController(authorizationRequests: [request])
      self.controller = controller
      controller.delegate = self
      controller.presentationContextProvider = self
      controller.performRequests()
    }
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    anchor
  }

  func authorizationController(
    controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization
  ) {
    guard
      let credential =
        authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
      let prf = credential.prf,
      prf.isSupported,
      let first = prf.first
    else {
      finish(.failure(PasskeyPrfNativeError.noPrf))
      return
    }
    let output = first.withUnsafeBytes { Data($0) }
    guard output.count == 32, !credential.credentialID.isEmpty else {
      finish(.failure(PasskeyPrfNativeError.invalidCredential))
      return
    }
    let attachment: String?
    switch credential.attachment {
    case .platform: attachment = "platform"
    case .crossPlatform: attachment = "cross-platform"
    @unknown default: attachment = nil
    }
    finish(.success((credential.credentialID, output, attachment, credential.rawAttestationObject)))
  }

  func authorizationController(
    controller: ASAuthorizationController, didCompleteWithError error: Error
  ) {
    let nsError = error as NSError
    if nsError.domain == ASAuthorizationError.errorDomain,
      nsError.code == ASAuthorizationError.canceled.rawValue
    {
      finish(.failure(PasskeyPrfNativeError.cancelled))
    } else if Self.isMatchedExcludedCredential(nsError) {
      finish(.failure(PasskeyPrfNativeError.alreadyRegistered))
    } else {
      finish(.failure(PasskeyPrfNativeError.invalidCredential))
    }
  }

  /// The provider refused because a credential from `excludedCredentials`
  /// already lives there. The error code only exists on iOS 18+, and the
  /// deployment target is lower, so the comparison needs the guard.
  private static func isMatchedExcludedCredential(_ error: NSError) -> Bool {
    guard error.domain == ASAuthorizationError.errorDomain else { return false }
    if #available(iOS 18.0, *) {
      return error.code == ASAuthorizationError.matchedExcludedCredential.rawValue
    }
    return false
  }

  private func finish(_ result: Result<(Data, Data, String?, Data?), Error>) {
    let continuation = self.continuation
    self.continuation = nil
    self.controller = nil
    continuation?.resume(with: result)
  }

  private static func randomBytes(count: Int) throws -> Data {
    var bytes = [UInt8](repeating: 0, count: count)
    guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else {
      throw PasskeyPrfNativeError.invalidInput
    }
    return Data(bytes)
  }
}

final class HybridPasskeyPrf: HybridPasskeyPrfSpec {
  func isSupported() throws -> Bool {
    if #available(iOS 18.0, *) { return true }
    return false
  }

  func createCredential(
    rpId: String, userName: String, userId: String, prfInput: String, excludeCredentialIds: [String]
  ) throws -> Promise<PasskeyPrfResult> {
    return Promise.async {
      guard #available(iOS 18.0, *) else {
        throw PasskeyPrfNativeError.unsupported
      }
      guard !rpId.isEmpty, !userName.isEmpty,
        let userIdData = Self.decodeBase64Url(userId), !userIdData.isEmpty,
        let prfInputData = Self.decodeBase64Url(prfInput), prfInputData.count == 32
      else {
        throw PasskeyPrfNativeError.invalidInput
      }
      let excluded = try excludeCredentialIds.map { value -> Data in
        guard let data = Self.decodeBase64Url(value), !data.isEmpty else {
          throw PasskeyPrfNativeError.invalidInput
        }
        return data
      }
      return try await Self.register(
        rpId: rpId, userName: userName, userId: userIdData, prfInput: prfInputData, excludeCredentialIds: excluded)
    }
  }

  @available(iOS 18.0, *)
  @MainActor
  private static func register(
    rpId: String, userName: String, userId: Data, prfInput: Data, excludeCredentialIds: [Data]
  ) async throws -> PasskeyPrfResult {
    guard let anchor = UIApplication.shared.connectedScenes
      .compactMap({ $0 as? UIWindowScene })
      .flatMap(\.windows)
      .first(where: \.isKeyWindow)
    else {
      throw PasskeyPrfNativeError.noPresentationAnchor
    }
    let coordinator = PasskeyRegistrationCoordinator(anchor: anchor)
    let (credentialId, prfOutput, attachment, attestationObject) = try await coordinator.perform(
      rpId: rpId, userName: userName, userId: userId, prfInput: prfInput, excludeCredentialIds: excludeCredentialIds)
    return PasskeyPrfResult(
      credentialId: encodeBase64Url(credentialId),
      prfOutput: encodeBase64Url(prfOutput),
      attachment: attachment,
      attestationObject: attestationObject.map(encodeBase64Url))
  }

  private static func decodeBase64Url(_ value: String) -> Data? {
    var base64 = value.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let padding = (4 - base64.count % 4) % 4
    base64.append(String(repeating: "=", count: padding))
    return Data(base64Encoded: base64)
  }

  private static func encodeBase64Url(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
