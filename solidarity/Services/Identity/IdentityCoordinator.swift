import Combine
import Foundation
import LocalAuthentication
import Security

// IdentityState and related types moved to IdentityState.swift

/// Coordinates DID, JWK, and Semaphore identity state across services and UI layers.
final class IdentityCoordinator: ObservableObject {
  static let shared = IdentityCoordinator()

  @Published var state: IdentityState

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
  let didService: DIDService
  let vcService: VCService
  let oidcService: OIDCService
  let semaphoreManager: SemaphoreIdentityManager
  private let groupManager: SemaphoreGroupManager
  let cacheStore: IdentityCacheStore
  let queue = DispatchQueue(label: "com.kidneyweakx.solidarity.identity-coordinator", qos: .userInitiated)
  let importHelper: IdentityImportHelper
  let verificationSubject: CurrentValueSubject<[UUID: VerificationStatus], Never>
  let verificationUpdateSubject = PassthroughSubject<IdentityState.VerificationEvent, Never>()
  let oidcEventSubject = PassthroughSubject<IdentityState.OIDCEvent, Never>()
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

  // MARK: - Internal helpers

  @MainActor
  func setLoading(_ loading: Bool) {
    if state.isLoading == loading { return }
    var next = state
    next.isLoading = loading
    state = next
  }

  func loadIdentity(context: LAContext?) async {
    await setLoading(true)

    print("[IdentityCoordinator] loadIdentity started")

    // Try cached descriptor first (avoids biometric auth for display)
    let cachedDescriptor = cacheStore.loadDescriptor()
    if let cached = cachedDescriptor {
      print("[IdentityCoordinator] Using cached DID descriptor: \(cached.did)")
    }

    // Try live derivation from keychain
    let descriptorResult = didService.currentDescriptor(context: context)
    let cachedDocs = cacheStore.loadDocuments()
    let cachedJwks = cacheStore.loadJwks()
    let identity = semaphoreManager.getIdentity() ?? (try? semaphoreManager.loadOrCreateIdentity())

    switch descriptorResult {
    case .success(let descriptor):
      print("[IdentityCoordinator] DID loaded successfully: \(descriptor.did)")
      // Cache for future loads (avoids biometric prompt)
      cacheStore.saveDescriptor(descriptor)
    case .failure(let error):
      print("[IdentityCoordinator] DID live derivation failed: \(error)")
      if cachedDescriptor != nil {
        print("[IdentityCoordinator] Falling back to cached descriptor")
      }
    }

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
        // Fall back to cached descriptor if live derivation failed
        // (e.g., biometric auth was cancelled)
        if let cached = cachedDescriptor {
          next.currentProfile.activeDID = cached
          next.lastError = nil
          if let doc = cachedDocs[cached.did] {
            next.didDocument = doc
          }
        } else {
          next.lastError = error
        }
      }

      state = next
    }
  }
}
