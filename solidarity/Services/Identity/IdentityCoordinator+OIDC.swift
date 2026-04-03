import Foundation

extension IdentityCoordinator {

  // MARK: - OIDC tracking

  func registerOIDCRequest(_ request: OIDCService.PresentationRequest) {
    queue.async {
      DispatchQueue.main.async {
        var next = self.state
        next.activeOIDCRequests[request.state] = request
        self.state = next
        self.recordOIDCEvent(
          IdentityState.OIDCEvent(
            kind: .requestCreated,
            state: request.state,
            message: "Created presentation request",
            timestamp: Date()
          )
        )
      }
    }
  }

  func resolveOIDCRequest(state: String) {
    queue.async {
      DispatchQueue.main.async {
        var next = self.state
        next.activeOIDCRequests.removeValue(forKey: state)
        self.state = next
      }
    }
  }

  func recordOIDCEvent(kind: IdentityState.OIDCEvent.Kind, state: String, message: String) {
    let event = IdentityState.OIDCEvent(kind: kind, state: state, message: message, timestamp: Date())
    recordOIDCEvent(event)
  }

  func recordOIDCEvent(_ event: IdentityState.OIDCEvent) {
    DispatchQueue.main.async {
      var next = self.state
      next.lastOIDCEvent = event
      self.state = next
      self.oidcEventSubject.send(event)
    }
  }
}
