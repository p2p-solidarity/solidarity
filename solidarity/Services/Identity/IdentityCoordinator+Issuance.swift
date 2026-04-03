import Foundation
import LocalAuthentication

extension IdentityCoordinator {

  // MARK: - Issuance

  func issueBusinessCardVC(
    for card: BusinessCard,
    context: LAContext? = nil,
    completion: ((CardResult<VCLibrary.StoredCredential>) -> Void)? = nil
  ) {
    queue.async {
      // 1. Ensure we have an active DID
      let didResult = self.didService.currentDescriptor(context: context)

      switch didResult {
      case .failure(let error):
        DispatchQueue.main.async { completion?(.failure(error)) }
        return

      case .success(let descriptor):
        // 2. Issue the credential using the DID
        let options = VCService.IssueOptions(
          holderDid: descriptor.did,
          issuerDid: descriptor.did,
          expiration: card.sharingPreferences.expirationDate,
          authenticationContext: context
        )

        let result = self.vcService.issueAndStoreBusinessCardCredential(
          for: card,
          options: options
        )

        DispatchQueue.main.async {
          if case .success = result {
            // Update verification status immediately since we just issued it
            self.updateVerificationStatus(for: card.id, status: .verified)
          }
          completion?(result)
        }
      }
    }
  }

  func issueGroupCredential(
    for card: BusinessCard,
    group: GroupModel,
    targetMembers: [GroupMemberModel]? = nil,
    expiration: Date? = nil,
    completion: (([GroupCredentialResult]) -> Void)? = nil
  ) {
    Task {
      do {
        let results = try await GroupCredentialService.shared.issueGroupCredential(
          for: card,
          group: group,
          targetMembers: targetMembers,
          expiration: expiration
        )

        DispatchQueue.main.async {
          completion?(results)
        }
      } catch {
        // Handle error (maybe log it or callback with empty/failure)
        print("Failed to issue group credential: \(error)")
        DispatchQueue.main.async {
          completion?([])  // Or change signature to return Result
        }
      }
    }
  }
}
