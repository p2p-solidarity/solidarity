import XCTest
@testable import solidarity

final class IdentityCoordinatorTests: XCTestCase {
    func testRegisterOIDCRequestPersistsState() throws {
        let coordinator = IdentityCoordinator(
            keychain: KeychainService(),
            didService: DIDService(),
            vcService: VCService(),
            oidcService: OIDCService.shared,
            semaphoreManager: SemaphoreIdentityManager.shared,
            groupManager: SemaphoreGroupManager.shared,
            cacheStore: IdentityCacheStore(),
            autoRefresh: false
        )

        let stateId = UUID().uuidString
        let request = OIDCService.PresentationRequest(
            id: UUID().uuidString,
            state: stateId,
            nonce: UUID().uuidString,
            clientId: "solidarity://oidc/callback",
            redirectUri: "solidarity://oidc/callback",
            responseType: "vp_token",
            presentationDefinition: .init(
                id: "test",
                inputDescriptors: []
            )
        )

        let expectation = expectation(description: "OIDC state updated")

        coordinator.registerOIDCRequest(request)

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            XCTAssertEqual(coordinator.state.activeOIDCRequests[request.state], request)
            XCTAssertEqual(coordinator.state.lastOIDCEvent?.state, request.state)
            expectation.fulfill()
        }

        wait(for: [expectation], timeout: 1.0)
    }
}
