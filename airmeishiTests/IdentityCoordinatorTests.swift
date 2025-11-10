import XCTest
@testable import airmeishi

final class IdentityCoordinatorTests: XCTestCase {
    func testRegisterOIDCRequestPersistsState() throws {
        let coordinator = IdentityCoordinator(
            keychain: KeychainService(),
            didService: DIDService(),
            vcService: VCService(),
            oidcService: OIDCService.shared,
            semaphoreManager: SemaphoreIdentityManager.shared,
            cacheStore: IdentityCacheStore(),
            autoRefresh: false
        )

        let request = OIDCService.PresentationRequest(
            clientId: "airmeishi://oidc/callback",
            redirectURI: "airmeishi://oidc/callback",
            responseType: "vp_token",
            responseMode: "direct_post",
            scope: "openid",
            state: UUID().uuidString,
            nonce: UUID().uuidString,
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
