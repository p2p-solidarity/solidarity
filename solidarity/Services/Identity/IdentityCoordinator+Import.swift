import Foundation
import LocalAuthentication

extension IdentityCoordinator {

  // MARK: - Import pipeline

  func importIdentity(
    from source: IdentityImportSource,
    context: LAContext? = nil,
    completion: ((CardResult<IdentityImportResult>) -> Void)? = nil
  ) {
    queue.async {
      let payloadResult = self.importHelper.resolvePayload(from: source, context: context)
      let result = payloadResult.map { self.makeResult(from: $0, source: source) }

      DispatchQueue.main.async {
        self.applyImportResult(result, from: source)
        completion?(result)
      }
    }
  }

  // Payload resolution logic moved to IdentityImportHelper

  func makeResult(
    from payload: IdentityImportResult.Payload,
    source: IdentityImportSource
  ) -> IdentityImportResult {
    let message: String

    switch payload {
    case .didDocument(let document):
      message = "Cached DID document for \(document.id)"

    case .publicJwk(_, let did):
      let target = did ?? state.currentProfile.activeDID?.did ?? "local identity"
      message = "Cached public JWK for \(target)"

    case .zkIdentity(let bundle):
      let prefix = String(bundle.commitment.prefix(8))
      message = "Updated Semaphore identity (commitment \(prefix))"

    case .credential(let credential):
      message = "Imported credential from \(credential.issuerDid)"

    case .presentationRequest(let request):
      message = "Loaded OIDC request \(request.presentationDefinition.id)"
    }

    return IdentityImportResult(payload: payload, message: message)
  }

  func applyImportResult(_ result: CardResult<IdentityImportResult>, from source: IdentityImportSource) {
    switch result {
    case .success(let success):
      var next = state
      next.lastError = nil
      next.lastImportEvent = IdentityState.ImportEvent(
        kind: source.kind,
        summary: success.message,
        timestamp: Date()
      )

      switch success.payload {
      case .didDocument(let document):
        next.cachedDocuments[document.id] = document
        if next.currentProfile.activeDID?.did == document.id {
          next.didDocument = document
        }
        cacheStore.saveDocuments(next.cachedDocuments)
        state = next
        refreshIdentity()

      case .publicJwk(let jwk, let did):
        let key = did ?? next.currentProfile.activeDID?.did ?? "local"
        next.cachedJwks[key] = jwk
        cacheStore.saveJwks(next.cachedJwks)
        state = next
        refreshIdentity()

      case .zkIdentity(let bundle):
        next.currentProfile.zkIdentity = bundle
        state = next
        refreshIdentity()

      case .credential:
        state = next

      case .presentationRequest:
        state = next
      }

    case .failure(let error):
      var next = state
      next.lastError = error
      state = next
    }
  }
}
