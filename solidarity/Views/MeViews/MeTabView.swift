import SwiftUI

struct MeTabView: View {
  @EnvironmentObject private var identityCoordinator: IdentityCoordinator
  @StateObject private var cardManager = CardManager.shared
  @StateObject private var qrCodeManager = QRCodeManager.shared
  @EnvironmentObject var identityDataStore: IdentityDataStore

  @ObservedObject var devMode = DeveloperModeManager.shared
  @StateObject var groupManager = CloudKitGroupSyncManager.shared
  @StateObject var idm = SemaphoreIdentityManager.shared

  @State private var showingSettings = false
  @State var showingEditProfile = false
  @State var showingVCSettings = false
  @State var showingPassportFlow = false
  @State var showingGroupManager = false
  @State var showingOIDCRequest = false
  @State var showingZKSettings = false
  @State var revealDid = false
  @State var preparingClaimID: String?
  @State private var preparedProof: PreparedSelfInitiatedProof?
  @State private var proofPreparationError: String?

  var verifiedCards: [IdentityCardEntity] {
    identityDataStore.identityCards.filter { $0.type != "business_card" }
  }

  var displayClaims: [ProvableClaimEntity] {
    var hasIncludedProfileCard = false
    return identityDataStore.provableClaims.filter { claim in
      guard claim.isPresentable else { return false }
      guard claim.claimType == "profile_card" else { return true }
      guard !hasIncludedProfileCard else { return false }
      hasIncludedProfileCard = true
      return true
    }
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 24) {
          identityHeader

          Rectangle()
            .fill(Color.Theme.divider)
            .frame(height: 1)

          identityCardSection

          provableClaimsSection

          addMoreSection

          if devMode.isDeveloperMode {
            devModeSection
          }
        }
        .padding(.vertical, 24)
        .padding(.bottom, 90)
      }
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("Me")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button {
            showingSettings = true
          } label: {
            Image(systemName: "gearshape.fill")
              .font(.system(size: 14))
              .foregroundColor(Color.Theme.textPrimary)
              .padding(8)
              .background(Color.Theme.searchBg)
              .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
          }
        }
      }
      .sheet(isPresented: $showingSettings) {
        NavigationStack {
          SettingsView()
        }
      }
      .sheet(isPresented: $showingEditProfile) {
        if let card = cardManager.businessCards.first {
          BusinessCardFormView(businessCard: card) { _ in
            showingEditProfile = false
          }
        } else {
          BusinessCardFormView(forceCreate: true) { _ in
            showingEditProfile = false
          }
        }
      }
      .sheet(isPresented: $showingVCSettings) {
        NavigationStack {
          VCSettingsView()
        }
      }
      .sheet(isPresented: $showingPassportFlow) {
        PassportOnboardingFlowView { _ in
          showingPassportFlow = false
        }
      }
      .sheet(item: $preparedProof) { preparedProof in
        SelfInitiatedProofSheet(preparedProof: preparedProof)
      }
      .sheet(isPresented: $showingGroupManager) {
        NavigationStack {
          GroupManagementView()
        }
      }
      .sheet(isPresented: $showingOIDCRequest) {
        OIDCRequestView()
      }
      .sheet(isPresented: $showingZKSettings) {
        ZKSettingsView()
      }
      .alert("Unable to Generate Proof", isPresented: proofErrorAlertPresented) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(proofPreparationError ?? "Unknown error")
      }
      .onAppear {
        if identityCoordinator.state.currentProfile.activeDID == nil,
           !identityCoordinator.state.isLoading {
          identityCoordinator.refreshIdentity()
        }
      }
    }
  }

  var displayName: String {
    cardManager.businessCards.first?.name ?? String(localized: "User Node")
  }

  var displayDid: String {
    if let did = identityCoordinator.state.currentProfile.activeDID?.did {
      return did
    }
    if identityCoordinator.state.isLoading {
      return "Loading..."
    }
    if let error = identityCoordinator.state.lastError {
      return "Error: \(error.localizedDescription)"
    }
    return "Initializing..."
  }

  func shortDid(_ did: String) -> String {
    guard did.count > 22 else { return did }
    return "\(did.prefix(12))...\(did.suffix(8))"
  }

  private var proofErrorAlertPresented: Binding<Bool> {
    Binding(
      get: { proofPreparationError != nil },
      set: { shouldShow in
        if !shouldShow {
          proofPreparationError = nil
        }
      }
    )
  }

  func prepareProofPresentation(for claim: ProvableClaimEntity) {
    guard preparingClaimID == nil else { return }
    preparingClaimID = claim.id

    Task { @MainActor in
      defer { preparingClaimID = nil }
      await Task.yield()

      switch buildPreparedProof(for: claim) {
      case .success(let proof):
        preparedProof = proof
        identityDataStore.markClaimPresented(claim.id)
      case .failure(let error):
        proofPreparationError = error.localizedDescription
      }
    }
  }

  private func buildPreparedProof(for claim: ProvableClaimEntity) -> CardResult<PreparedSelfInitiatedProof> {
    let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "")

    let vp: [String: Any] = [
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      "type": ["VerifiablePresentation"],
      "verifiableCredential": [claim.payload],
      "nonce": nonce,
      "claim_type": claim.claimType,
    ]

    let qrString: String
    if let data = try? JSONSerialization.data(withJSONObject: vp, options: [.sortedKeys]),
       let json = String(data: data, encoding: .utf8) {
      qrString = json
    } else {
      qrString = claim.payload
    }

    switch qrCodeManager.generateQRCode(from: qrString) {
    case .success(let image):
      return .success(PreparedSelfInitiatedProof(claim: claim, qrImage: image))
    case .failure(let error):
      return .failure(error)
    }
  }

}
