//
//  IDView.swift
//  airmeishi
//
//  Unified identity and group management with ripple animation, OpenID, and ZK settings
//

import SwiftUI

struct IDView: View {
  @ObservedObject internal var coordinator = IdentityCoordinator.shared
  @StateObject internal var groupManager = CloudKitGroupSyncManager.shared
  @StateObject internal var idm = SemaphoreIdentityManager.shared

  // UI State
  @State internal var showingGroupManager = false
  @State internal var showingOIDCRequest = false
  @State internal var showingZKSettings = false
  @State internal var selectedGroup: GroupModel?
  @State internal var isWorking = false
  @State internal var showErrorAlert = false
  @State internal var errorMessage: String?

  // Computed Properties
  internal var profile: UnifiedProfile {
    coordinator.state.currentProfile
  }

  internal var rippleState: RippleButtonState {
    if coordinator.state.isLoading || isWorking {
      return .processing
    }
    if profile.zkIdentity == nil {
      return .idle
    }
    return .idle
  }

  var body: some View {
    NavigationStack {
      ZStack {
        // Background
        Color(.systemGroupedBackground)
          .ignoresSafeArea()

        ScrollView {
          VStack(spacing: 0) {
            // 1. The Mask (DID Switcher)
            maskSection
              .padding(.top, 20)
              .padding(.bottom, 40)

            // 2. The Core (Ripple Button)
            coreSection

            Spacer()
              .frame(height: 40)

            // 3. The Badge (Group Cards)
            badgeSection
              .padding(.bottom, 20)
          }
        }
      }
      .navigationTitle("ID")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          HStack(spacing: 12) {
            MatchingBarView()
            Button(
              action: {
                showingOIDCRequest = true
              },
              label: {
                Image(systemName: "qrcode")
                  .foregroundColor(.primary)
              }
            )

            Button(
              action: {
                coordinator.refreshIdentity()
              },
              label: {
                Image(systemName: "arrow.clockwise")
                  .foregroundColor(.primary)
              }
            )
          }
        }

        ToolbarItem(placement: .navigationBarLeading) {
          Button(
            action: {
              showingZKSettings = true
            },
            label: {
              Image(systemName: "gearshape")
                .foregroundColor(.primary)
            }
          )
        }
      }
      .alert(
        "Error",
        isPresented: $showErrorAlert,
        actions: {
          Button("OK", role: .cancel) {}
        },
        message: {
          Text(errorMessage ?? "Unknown error")
        }
      )
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
      .onAppear {
        groupManager.startSyncEngine()
      }
    }
  }
}
