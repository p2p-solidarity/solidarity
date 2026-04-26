import Foundation
import LocalAuthentication

enum SensitiveAction: String, CaseIterable, Identifiable {
  case issueCredential
  case presentProof
  case exportGraph
  case rotateMasterKey
  case revealRecoveryBundle
  case registerTrustAnchor

  var id: String { rawValue }

  var prompt: String {
    switch self {
    case .issueCredential:
      return "Authenticate to issue a verifiable credential."
    case .presentProof:
      return "Authenticate to present a proof."
    case .exportGraph:
      return "Authenticate to export your verified contact graph."
    case .rotateMasterKey:
      return "Authenticate to rotate your DID master key."
    case .revealRecoveryBundle:
      return "Authenticate to access social recovery data."
    case .registerTrustAnchor:
      return "Authenticate to add a trusted issuer."
    }
  }
}

final class BiometricGatekeeper {
  static let shared = BiometricGatekeeper()

  private init() {}

  func authorize(_ action: SensitiveAction, completion: @escaping (CardResult<Void>) -> Void) {
    let context = LAContext()

    // Prefer biometrics-only (Face ID / Touch ID) — no "Use Passcode" button.
    // If the device has no enrolled biometric, falls back to passcode auth so
    // the user isn't locked out of sensitive flows.
    let policy: LAPolicy =
      context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        ? .deviceOwnerAuthenticationWithBiometrics
        : .deviceOwnerAuthentication

    var evaluationError: NSError?
    guard context.canEvaluatePolicy(policy, error: &evaluationError) else {
      let message = evaluationError?.localizedDescription ?? "Biometric authentication is unavailable."
      completion(.failure(.keyManagementError(message)))
      return
    }

    context.evaluatePolicy(policy, localizedReason: action.prompt) { success, error in
      DispatchQueue.main.async {
        if success {
          completion(.success(()))
          return
        }

        let message = error?.localizedDescription ?? "Authentication was cancelled."
        completion(.failure(.keyManagementError(message)))
      }
    }
  }

  func authorizeIfRequired(_ action: SensitiveAction, completion: @escaping (CardResult<Void>) -> Void) {
    if !SensitiveActionPolicyStore.shared.requiresBiometric(action) {
      completion(.success(()))
      return
    }
    authorize(action, completion: completion)
  }
}
