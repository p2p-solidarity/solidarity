import Foundation
import Combine
import LocalAuthentication
import Security

struct IdentityState: Equatable {
    struct VerificationEvent: Equatable {
        let cardId: UUID
        let status: VerificationStatus
        let timestamp: Date
    }

    struct ImportEvent: Equatable {
        let kind: IdentityImportKind
        let summary: String
        let timestamp: Date
    }

    struct OIDCEvent: Equatable {
        enum Kind: String {
            case requestCreated
            case credentialImported
            case error
        }

        let kind: Kind
        let state: String
        let message: String
        let timestamp: Date
    }

    var isLoading: Bool
    var activeDid: DIDDescriptor?
    var didDocument: DIDDocument?
    var cachedDocuments: [String: DIDDocument]
    var cachedJwks: [String: PublicKeyJWK]
    var zkIdentity: SemaphoreIdentityManager.IdentityBundle?
    var verificationCache: [UUID: VerificationStatus]
    var lastVerificationUpdate: VerificationEvent?
    var lastImportEvent: ImportEvent?
    var lastError: CardError?
    var activeOIDCRequests: [String: OIDCService.PresentationRequest]
    var lastOIDCEvent: OIDCEvent?
}

enum IdentityImportKind: String {
    case oidcResponse
    case qrPayload
    case file
    case clipboard
}

enum IdentityImportSource {
    case oidcResponse(URL)
    case qrPayload(String)
    case fileURL(URL)
    case clipboard(String)

    var kind: IdentityImportKind {
        switch self {
        case .oidcResponse: return .oidcResponse
        case .qrPayload: return .qrPayload
        case .fileURL: return .file
        case .clipboard: return .clipboard
        }
    }
}

struct IdentityImportResult: Equatable {
    enum Payload: Equatable {
        case didDocument(DIDDocument)
        case publicJwk(PublicKeyJWK, did: String?)
        case zkIdentity(SemaphoreIdentityManager.IdentityBundle)
        case credential(VCLibrary.StoredCredential)
        case presentationRequest(OIDCService.PresentationRequest)
    }

    let payload: Payload
    let message: String
}

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
    private let cacheStore: IdentityCacheStore
    private let queue = DispatchQueue(label: "com.kidneyweakx.airmeishi.identity-coordinator", qos: .userInitiated)
    private let verificationSubject: CurrentValueSubject<[UUID: VerificationStatus], Never>
    private let verificationUpdateSubject = PassthroughSubject<IdentityState.VerificationEvent, Never>()
    private let oidcEventSubject = PassthroughSubject<IdentityState.OIDCEvent, Never>()

    init(
        keychain: KeychainService = .shared,
        didService: DIDService = DIDService(),
        vcService: VCService = VCService(),
        oidcService: OIDCService = .shared,
        semaphoreManager: SemaphoreIdentityManager = .shared,
        cacheStore: IdentityCacheStore = IdentityCacheStore(),
        autoRefresh: Bool = true
    ) {
        self.keychain = keychain
        self.didService = didService
        self.vcService = vcService
        self.oidcService = oidcService
        self.semaphoreManager = semaphoreManager
        self.cacheStore = cacheStore

        let cachedDocs = cacheStore.loadDocuments()
        let cachedJwks = cacheStore.loadJwks()
        let zkIdentity = semaphoreManager.getIdentity() ?? (try? semaphoreManager.loadOrCreateIdentity())

        let initialState = IdentityState(
            isLoading: false,
            activeDid: nil,
            didDocument: nil,
            cachedDocuments: cachedDocs,
            cachedJwks: cachedJwks,
            zkIdentity: zkIdentity,
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

        if autoRefresh { refreshIdentity() }
    }

    // MARK: - Identity lifecycle

    func refreshIdentity(context: LAContext? = nil) {
        Task.detached { [weak self] in
            guard let self else { return }
            await self.loadIdentity(context: context)
            // Ensure ZK identity is synchronized with DID
            await self.syncZKIdentity()
        }
    }
    
    @MainActor
    private func syncZKIdentity() {
        // Ensure ZK identity exists and is linked with DID
        if state.zkIdentity == nil {
            if let bundle = try? semaphoreManager.loadOrCreateIdentity() {
                var next = state
                next.zkIdentity = bundle
                state = next
                ZKLog.info("ZK identity synchronized with DID system")
            }
        }
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

    // MARK: - Import pipeline

    func importIdentity(
        from source: IdentityImportSource,
        context: LAContext? = nil,
        completion: ((CardResult<IdentityImportResult>) -> Void)? = nil
    ) {
        queue.async {
            let payloadResult = self.resolvePayload(from: source, context: context)
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

        let descriptorResult = didService.currentDidKey(context: context)
        let cachedDocs = cacheStore.loadDocuments()
        let cachedJwks = cacheStore.loadJwks()
        let identity = semaphoreManager.getIdentity() ?? (try? semaphoreManager.loadOrCreateIdentity())

        await MainActor.run {
            var next = state
            next.isLoading = false
            next.cachedDocuments = cachedDocs
            next.cachedJwks = cachedJwks
            next.zkIdentity = identity ?? next.zkIdentity

            switch descriptorResult {
            case .success(let descriptor):
                next.activeDid = descriptor
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

    private func resolvePayload(
        from source: IdentityImportSource,
        context: LAContext?
    ) -> CardResult<IdentityImportResult.Payload> {
        switch source {
        case .oidcResponse(let url):
            return oidcService.handleResponse(url: url, vcService: vcService)
                .map { .credential($0.storedCredential) }

        case .qrPayload(let raw), .clipboard(let raw):
            return parseRawPayload(raw)

        case .fileURL(let url):
            do {
                let data = try Data(contentsOf: url)
                if let string = String(data: data, encoding: .utf8), !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    return parseRawPayload(string)
                }
                return parseBinaryPayload(data)
            } catch {
                return .failure(.invalidData("Failed to read identity file: \(error.localizedDescription)"))
            }
        }
    }

    private func parseRawPayload(_ raw: String, allowBase64Retry: Bool = true) -> CardResult<IdentityImportResult.Payload> {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .failure(.invalidData("Import payload is empty"))
        }

        if let url = URL(string: trimmed), trimmed.hasPrefix("airmeishi://oidc") {
            return resolvePayload(from: .oidcResponse(url), context: nil)
        }

        if trimmed.hasPrefix("openid-vc://") || trimmed.hasPrefix("openid://") {
            return oidcService.parseRequest(from: trimmed)
                .map { .presentationRequest($0) }
        }

        if let data = trimmed.data(using: .utf8) {
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .useDefaultKeys

            if let document = try? decoder.decode(DIDDocument.self, from: data) {
                return .success(.didDocument(document))
            }

            if let jwk = try? decoder.decode(PublicKeyJWK.self, from: data) {
                return .success(.publicJwk(jwk, did: nil))
            }

            if let payload = parseEnvelopePayload(from: data) {
                return payload
            }
        }

        let jwtSegments = trimmed.split(separator: ".")
        if jwtSegments.count == 3 {
            return importCredential(jwt: trimmed)
        }

        if allowBase64Retry, let data = Data(base64Encoded: trimmed) {
            if data.count == 32 || data.count == 64 {
                return importSemaphoreIdentity(privateKey: data)
            }

            if let string = String(data: data, encoding: .utf8), string != trimmed {
                return parseRawPayload(string, allowBase64Retry: false)
            }
        }

        return .failure(.invalidData("Unsupported identity payload format"))
    }

    private func parseBinaryPayload(_ data: Data) -> CardResult<IdentityImportResult.Payload> {
        if data.count == 32 || data.count == 64 {
            return importSemaphoreIdentity(privateKey: data)
        }

        if let string = String(data: data, encoding: .utf8) {
            return parseRawPayload(string)
        }

        return .failure(.invalidData("Binary payload cannot be parsed as identity data"))
    }

    private func parseEnvelopePayload(from data: Data) -> CardResult<IdentityImportResult.Payload>? {
        guard
            let object = try? JSONSerialization.jsonObject(with: data, options: []),
            let json = object as? [String: Any]
        else { return nil }

        if let documentJSON = json["document"] {
            if let docData = try? JSONSerialization.data(withJSONObject: documentJSON),
               let document = try? JSONDecoder().decode(DIDDocument.self, from: docData) {
                return .success(.didDocument(document))
            }
        }

        if let jwkJSON = json["jwk"] {
            if let jwkData = try? JSONSerialization.data(withJSONObject: jwkJSON),
               let jwk = try? JSONDecoder().decode(PublicKeyJWK.self, from: jwkData) {
                let didHint = json["did"] as? String
                return .success(.publicJwk(jwk, did: didHint))
            }
        }

        if let jwkString = json["jwk"] as? String,
           let jwkData = jwkString.data(using: .utf8),
           let jwk = try? JSONDecoder().decode(PublicKeyJWK.self, from: jwkData) {
            let didHint = json["did"] as? String
            return .success(.publicJwk(jwk, did: didHint))
        }

        if let privateKey = json["privateKey"] as? String ?? json["semaphorePrivateKey"] as? String,
           let data = Data(base64Encoded: privateKey) {
            return importSemaphoreIdentity(privateKey: data)
        }

        if let credential = json["credential"] as? String {
            return importCredential(jwt: credential)
        }

        return nil
    }

    private func importCredential(jwt: String) -> CardResult<IdentityImportResult.Payload> {
        vcService.importPresentedCredential(jwt: jwt)
            .map { .credential($0.storedCredential) }
    }

    private func importSemaphoreIdentity(privateKey: Data) -> CardResult<IdentityImportResult.Payload> {
        do {
            let bundle = try semaphoreManager.importIdentity(privateKey: privateKey)
            return .success(.zkIdentity(bundle))
        } catch {
            return .failure(.cryptographicError("Failed to import Semaphore identity: \(error.localizedDescription)"))
        }
    }

    private func makeResult(from payload: IdentityImportResult.Payload, source: IdentityImportSource) -> IdentityImportResult {
        let message: String

        switch payload {
        case .didDocument(let document):
            message = "Cached DID document for \(document.id)"

        case .publicJwk(_, let did):
            let target = did ?? state.activeDid?.did ?? "local identity"
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
                if next.activeDid?.did == document.id {
                    next.didDocument = document
                }
                cacheStore.saveDocuments(next.cachedDocuments)
                state = next
                refreshIdentity()

            case .publicJwk(let jwk, let did):
                let key = did ?? next.activeDid?.did ?? "local"
                next.cachedJwks[key] = jwk
                cacheStore.saveJwks(next.cachedJwks)
                state = next
                refreshIdentity()

            case .zkIdentity(let bundle):
                next.zkIdentity = bundle
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
