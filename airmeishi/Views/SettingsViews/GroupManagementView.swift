//
//  GroupManagementView.swift
//  airmeishi
//
//  Manage group membership: view root, add/remove members, join via code/url.
//

import CloudKit
import MultipeerConnectivity
import SwiftUI
import UIKit

struct GroupManagementView: View {
  @StateObject private var groupManager = CloudKitGroupSyncManager.shared
  @StateObject private var proximity = ProximityManager.shared
  @State private var activeSheet: SheetType?
  @State private var showDeleteConfirm: Bool = false
  @State private var selectedGroupToDelete: GroupModel?
  @State private var activeShare: CKShare?
  @State private var activeContainer: CKContainer?
  @Environment(\.dismiss) private var dismiss

  private enum SheetType: String, Identifiable {
    case root, create, invite, privacy, terms, share
    var id: String { rawValue }
  }

  var body: some View {
    ZStack {
      // Simple gradient background
      LinearGradient(
        colors: [
          Color(red: 0.05, green: 0.05, blue: 0.08),
          Color(red: 0.08, green: 0.08, blue: 0.12),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
      .ignoresSafeArea()

      VStack(spacing: 0) {
        // Header Section
        VStack(alignment: .leading, spacing: 16) {
          HStack(spacing: 16) {
            // Simple icon
            ZStack {
              RoundedRectangle(cornerRadius: 16)
                .fill(Color.white.opacity(0.1))
                .frame(width: 50, height: 50)

              Image(systemName: "person.3.sequence.fill")
                .font(.system(size: 24))
                .foregroundColor(.white)
            }

            VStack(alignment: .leading, spacing: 6) {
              Text("Group Management")
                .font(.system(size: 28, weight: .bold))
                .foregroundColor(.white)

              HStack {
                Text("Manage your groups and members")
                  .font(.subheadline)
                  .foregroundColor(.white.opacity(0.6))

                Spacer()

                // Sync Status Indicator
                switch groupManager.syncStatus {
                case .idle:
                  EmptyView()
                case .syncing:
                  HStack(spacing: 4) {
                    ProgressView()
                      .scaleEffect(0.6)
                    Text("Syncing...")
                      .font(.caption)
                      .foregroundColor(.white.opacity(0.6))
                  }
                case .error(let error):
                  Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundColor(.red)
                    .onTapGesture {
                      print("Sync Error: \(error)")
                    }
                case .offline:
                  Image(systemName: "wifi.slash")
                    .foregroundColor(.white.opacity(0.4))
                }
              }
            }

            Spacer()
          }
          .padding(20)
        }
        .background(
          RoundedRectangle(cornerRadius: 20)
            .fill(Color.white.opacity(0.08))
            .overlay(
              RoundedRectangle(cornerRadius: 20)
                .stroke(Color.white.opacity(0.15), lineWidth: 1)
            )
        )
        .adaptivePadding(horizontal: 20, vertical: 0)
        .padding(.top, 20)
        .padding(.bottom, 24)

        // Authentication Warning
        if !groupManager.isAuthenticated {
          HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
              .foregroundColor(.yellow)

            VStack(alignment: .leading, spacing: 2) {
              Text("iCloud Sign-In Required")
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundColor(.white)

              if case .couldNotDetermine = groupManager.accountStatus {
                Text("Could not determine iCloud status. Please check Settings.")
                  .font(.caption)
                  .foregroundColor(.white.opacity(0.8))
              } else if case .restricted = groupManager.accountStatus {
                Text("iCloud access is restricted.")
                  .font(.caption)
                  .foregroundColor(.white.opacity(0.8))
              } else if case .noAccount = groupManager.accountStatus {
                Text("Please sign in to iCloud in Settings.")
                  .font(.caption)
                  .foregroundColor(.white.opacity(0.8))
              } else {
                Text("Please sign in to iCloud in Settings to use group features.")
                  .font(.caption)
                  .foregroundColor(.white.opacity(0.8))
              }

              Button(action: {
                Task {
                  await groupManager.checkAccountStatus()
                }
              }) {
                Text("Retry")
                  .font(.caption)
                  .fontWeight(.bold)
                  .foregroundColor(.yellow)
                  .padding(.top, 2)
              }
            }

            Spacer()
          }
          .padding(16)
          .background(Color.yellow.opacity(0.15))
          .cornerRadius(12)
          .overlay(
            RoundedRectangle(cornerRadius: 12)
              .stroke(Color.yellow.opacity(0.3), lineWidth: 1)
          )
          .adaptivePadding(horizontal: 20, vertical: 0)
          .padding(.bottom, 16)
        }

        // Main Actions Section with enhanced cards
        ScrollView {
          VStack(alignment: .leading, spacing: 24) {
            // Group Actions
            VStack(alignment: .leading, spacing: 16) {
              Text("Actions")
                .font(.title3)
                .fontWeight(.bold)
                .foregroundColor(.white)
                .padding(.horizontal, 20)
                .padding(.top, 8)

              VStack(spacing: 1) {
                SimpleNodeRow(icon: "plus.circle.fill", title: "Create Group", subtitle: "Create a new CloudKit group")
                { activeSheet = .create }
                SimpleNodeRow(icon: "link", title: "Invite via Link", subtitle: "Generate invite link for members") {
                  activeSheet = .invite
                }
              }
            }
            .padding(4)
            .background(
              RoundedRectangle(cornerRadius: 16)
                .fill(Color.white.opacity(0.06))
                .overlay(
                  RoundedRectangle(cornerRadius: 16)
                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
                )
            )
            .adaptivePadding(horizontal: 20, vertical: 0)

            // Your Groups List (Categorized)
            YourGroupsSectionView(
              groupManager: groupManager,
              selectedGroupToDelete: $selectedGroupToDelete,
              showDeleteConfirm: $showDeleteConfirm
            )

            // Legal & Privacy
            VStack(alignment: .leading, spacing: 16) {
              Text("Legal & Privacy")
                .font(.title3)
                .fontWeight(.bold)
                .foregroundColor(.white)
                .padding(.horizontal, 20)
                .padding(.top, 8)

              VStack(spacing: 1) {
                SimpleNodeRow(icon: "hand.raised", title: "Privacy Policy", subtitle: "View our privacy policy") {
                  activeSheet = .privacy
                }
                SimpleNodeRow(icon: "doc.text", title: "Terms of Service", subtitle: "View terms of service") {
                  activeSheet = .terms
                }
              }
            }
            .padding(4)
            .background(
              RoundedRectangle(cornerRadius: 16)
                .fill(Color.white.opacity(0.06))
                .overlay(
                  RoundedRectangle(cornerRadius: 16)
                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
                )
            )
            .adaptivePadding(horizontal: 20, vertical: 0)
            .padding(.bottom, 40)
          }
        }
        .refreshable {
          try? await groupManager.fetchLatestChanges()
        }
      }
      .adaptiveMaxWidth(900)
      .safeAreaInset(edge: .top) {
        HStack {
          Button(action: { dismiss() }) {
            HStack(spacing: 8) {
              Image(systemName: "xmark.circle.fill")
              Text("Done")
                .fontWeight(.semibold)
            }
            .foregroundColor(.white)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(
              Capsule()
                .fill(Color.white.opacity(0.15))
                .background(
                  Capsule()
                    .stroke(Color.white.opacity(0.3), lineWidth: 1)
                )
            )
          }
          Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
      }
    }
    .navigationBarHidden(true)
    .onAppear {
      groupManager.startSyncEngine()
    }
    .sheet(item: $activeSheet) { sheet in
      switch sheet {
      case .root:
        EmptyView()
      case .create:
        CreateGroupView()
      case .invite:
        InviteLinkView { share, container in
          self.activeShare = share
          self.activeContainer = container
          // Delay slightly to allow sheet dismissal/swap
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            self.activeSheet = .share
          }
        }
      case .privacy:
        privacySheet
      case .terms:
        termsSheet
      case .share:
        if let share = activeShare, let container = activeContainer {
          CloudSharingView(share: share, container: container)
        }
      }
    }
    .alert("Delete Group?", isPresented: $showDeleteConfirm) {
      Button("Delete", role: .destructive) {
        if let group = selectedGroupToDelete {
          Task {
            try? await groupManager.deleteGroup(group)
          }
        }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This will remove the group. This action cannot be undone.")
    }
  }

  // MARK: - Helpers

  // MARK: - Sheets

  private var inviteSheet: some View {
    InviteLinkView()
  }

  private var privacySheet: some View {
    NavigationView {
      ScrollView {
        Text("Privacy Policy Content...")
          .padding()
      }
      .navigationTitle("Privacy Policy")
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Done") { activeSheet = nil }
        }
      }
    }
  }

  private var termsSheet: some View {
    NavigationView {
      ScrollView {
        Text("Terms of Service Content...")
          .padding()
      }
      .navigationTitle("Terms of Service")
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Done") { activeSheet = nil }
        }
      }
    }
  }
}
