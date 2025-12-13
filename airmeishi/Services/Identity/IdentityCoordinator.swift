import Foundation
import Combine
import LocalAuthentication
import Security

// IdentityState and related types moved to IdentityState.swift

/// Coordinates DID, JWK, and Semaphore identity state across services and UI layers.
final class IdentityCoordinator: ObservableObject {
    static let shared = IdentityCoordinator()

    @Published private(set) var state: IdentityState

    var statePublisher: AnyPublisher<IdentityState, Never> {
        $state.eraseToAnyPublisher()
    }

    var verificationStatusesPublisher: AnyPublisher<[UUID: VerificationStatus], Never> {
        verificationSubject.eraseToAnyPublisher()
    }

    var verificationUpdates: AnyPublisher<IdentityState.VerificationEvent, Never> {
        verificationUpdateSubject.eraseToAnyPublisher()
    }

    var oidcEvents: AnyPublisher<IdentityState.OIDCEvent, Never> {
        oidcEventSubject.eraseToAnyPublisher()
    }

    private let keychain: KeychainService
    private let didService: DIDService
    private let vcService: VCService
    private let oidcService: OIDCService
    private let semaphoreManager: SemaphoreIdentityManager
    private let groupManager: SemaphoreGroupManager
    private let cacheStore: IdentityCacheStore
    private let queue = DispatchQueue(label: "com.kidneyweakx.airmeishi.identity-coordinator", qos: .userInitiated)
    private let importHelper: IdentityImportHelper
    private let verificationSubject: CurrentValueSubject<[UUID: VerificationStatus], Never>
    private let verificationUpdateSubject = PassthroughSubject<IdentityState.VerificationEvent, Never>()
    private let oidcEventSubject = PassthroughSubject<IdentityState.OIDCEvent, Never>()
    private var cancellables = Set<AnyCancellable>()

    init(
        keychain: KeychainService = .shared,
        didService: DIDService = DIDService(),
        vcService: VCService = VCService(),
        oidcService: OIDCService = .shared,
        semaphoreManager: SemaphoreIdentityManager = .shared,
        groupManager: SemaphoreGroupManager = .shared,
        cacheStore: IdentityCacheStore = IdentityCacheStore(),
        autoRefresh: Bool = true
    ) {
        self.keychain = keychain
        self.didService = didService
        self.vcService = vcService
        self.oidcService = oidcService
        self.semaphoreManager = semaphoreManager
        self.groupManager = groupManager
        self.cacheStore = cacheStore
        self.importHelper = IdentityImportHelper(
            oidcService: oidcService,
            vcService: vcService,
            semaphoreManager: semaphoreManager
        )

        let cachedDocs = cacheStore.loadDocuments()
        let cachedJwks = cacheStore.loadJwks()
        let zkIdentity = semaphoreManager.getIdentity() ?? (try? semaphoreManager.loadOrCreateIdentity())
        
        let initialProfile = UnifiedProfile(
            zkIdentity: zkIdentity,
            activeDID: nil,
            memberships: []
        )

        let initialState = IdentityState(
            isLoading: false,
            currentProfile: initialProfile,
            didDocument: nil,
            cachedDocuments: cachedDocs,
            cachedJwks: cachedJwks,
            verificationCache: [:],
            lastVerificationUpdate: nil,
            lastImportEvent: nil,
            lastError: nil,
            activeOIDCRequests: [:],
            lastOIDCEvent: nil
        )

        self.state = initialState
        self.verificationSubject = CurrentValueSubject(initialState.verificationCache)

        self.oidcService.attachIdentityCoordinator(self)

        // Subscribe to group updates
        self.groupManager.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                // Delay slightly to allow state to update
                DispatchQueue.main.async {
                    self?.refreshMemberships()
                }
            }
            .store(in: &cancellables)

        if autoRefresh { refreshIdentity() }
    }

    // MARK: - Identity lifecycle

    func refreshIdentity(context: LAContext? = nil) {
        Task.detached { [weak self] in
            guard let self else { return }
            await self.loadIdentity(context: context)
            await self.syncZKIdentity()
            await self.refreshMemberships()
        }
    }
    
    @MainActor
    func switchDID(method: DIDService.DIDMethod) {
        Task {
            setLoading(true)
            // Update DID Service preference (if we were persisting it)
            // For now, we just request the specific DID type
            
            let result = didService.switchMethod(to: method)
            
            switch result {
            case .success(let descriptor):
                var next = state
                next.currentProfile.activeDID = descriptor
                // Update document if cached
                if let doc = next.cachedDocuments[descriptor.did] {
                    next.didDocument = doc
                } else {
                    // Generate fresh document
                    if let doc = try? didService.document(for: descriptor, services: []) {
                        next.didDocument = doc
                        next.cachedDocuments[descriptor.did] = doc
                    }
                }
                state = next
                
            case .failure(let error):
                var next = state
                next.lastError = error
                state = next
            }
            
            setLoading(false)
        }
    }
    
    @MainActor
    private func syncZKIdentity() {
        // Ensure ZK identity exists and is linked with DID
        if state.currentProfile.zkIdentity == nil {
            if let bundle = try? semaphoreManager.loadOrCreateIdentity() {
                var next = state
                next.currentProfile.zkIdentity = bundle
                state = next
                ZKLog.info("ZK identity synchronized with DID system")
            }
        }
    }
    
    @MainActor
    private func refreshMemberships() {
        guard let commitment = state.currentProfile.zkIdentity?.commitment else { return }
        
        let groups = groupManager.allGroups
        let memberships = groups.map { group -> GroupMembership in
            let isMember = group.members.contains(commitment)
            let index = group.members.firstIndex(of: commitment)
            
            // Determine status
            let status: GroupMembership.MembershipStatus
            if isMember {
                // Simple logic: if root is outdated (simulated check), or if we just want to show active
                // For now, assume active if member
                status = .active
            } else {
                status = .notMember
            }
            
            return GroupMembership(
                id: group.id.uuidString,
                name: group.name,
                status: status,
                memberIndex: index
            )
        }
        
        var next = state
        next.currentProfile.memberships = memberships
        state = next
    }

    @MainActor
    func clearError() {
        var next = state
        next.lastError = nil
        state = next
    }

    func cachedDocument(for did: String) -> DIDDocument? {
        state.cachedDocuments[did]
    }

    func cachedJwk(for did: String) -> PublicKeyJWK? {
        state.cachedJwks[did]
    }

    func verificationStatus(for cardId: UUID) -> VerificationStatus? {
        state.verificationCache[cardId]
    }

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
                    completion?([]) // Or change signature to return Result
                }
            }
        }
    }

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

    // MARK: - OIDC tracking

    func registerOIDCRequest(_ request: OIDCService.PresentationRequest) {
        queue.async {
            DispatchQueue.main.async {
                var next = self.state
                next.activeOIDCRequests[request.state] = request
                self.state = next
                self.recordOIDCEvent(
                    IdentityState.OIDCEvent(kind: .requestCreated, state: request.state, message: "Created presentation request", timestamp: Date())
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

    private func recordOIDCEvent(_ event: IdentityState.OIDCEvent) {
        DispatchQueue.main.async {
            var next = self.state
            next.lastOIDCEvent = event
            self.state = next
            self.oidcEventSubject.send(event)
        }
    }

    // MARK: - Internal helpers

    @MainActor
    private func setLoading(_ loading: Bool) {
        if state.isLoading == loading { return }
        var next = state
        next.isLoading = loading
        state = next
    }

    private func loadIdentity(context: LAContext?) async {
        await setLoading(true)

        let descriptorResult = didService.currentDescriptor(context: context)
        let cachedDocs = cacheStore.loadDocuments()
        let cachedJwks = cacheStore.loadJwks()
        let identity = semaphoreManager.getIdentity() ?? (try? semaphoreManager.loadOrCreateIdentity())

        await MainActor.run {
            var next = state
            next.isLoading = false
            next.cachedDocuments = cachedDocs
            next.cachedJwks = cachedJwks
            next.currentProfile.zkIdentity = identity ?? next.currentProfile.zkIdentity

            switch descriptorResult {
            case .success(let descriptor):
                next.currentProfile.activeDID = descriptor
                next.lastError = nil
                if let doc = cachedDocs[descriptor.did] {
                    next.didDocument = doc
                }
            case .failure(let error):
                next.lastError = error
            }

            state = next
        }
    }

    // Payload resolution logic moved to IdentityImportHelper

    private func makeResult(from payload: IdentityImportResult.Payload, source: IdentityImportSource) -> IdentityImportResult {
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

    private func applyImportResult(_ result: CardResult<IdentityImportResult>, from source: IdentityImportSource) {
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
