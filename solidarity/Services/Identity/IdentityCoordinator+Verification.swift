import Foundation

extension IdentityCoordinator {

  // MARK: - Verification cache

  func updateVerificationStatus(for cardId: UUID, status: VerificationStatus) {
    queue.async {
      var snapshot = self.verificationSubject.value
      snapshot[cardId] = status
      self.verificationSubject.send(snapshot)

      let event = IdentityState.VerificationEvent(cardId: cardId, status: status, timestamp: Date())

      DispatchQueue.main.async {
        var next = self.state
        next.verificationCache = snapshot
        next.lastVerificationUpdate = event
        next.lastError = nil
        self.state = next
        self.verificationUpdateSubject.send(event)
      }
    }
  }

  func mergeVerificationStatuses(_ statuses: [UUID: VerificationStatus]) {
    queue.async {
      var snapshot = self.verificationSubject.value
      for (key, value) in statuses { snapshot[key] = value }
      self.verificationSubject.send(snapshot)

      DispatchQueue.main.async {
        var next = self.state
        next.verificationCache = snapshot
        next.lastError = nil
        self.state = next
      }
    }
  }

  func resetVerificationCache() {
    queue.async {
      self.verificationSubject.send([:])
      DispatchQueue.main.async {
        var next = self.state
        next.verificationCache = [:]
        next.lastVerificationUpdate = nil
        self.state = next
      }
    }
  }
}
