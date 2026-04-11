//
//  GroupManagementView.swift
//  solidarity
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
          Color.Theme.pageBg,
          Color.Theme.pageBg,
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
                .fill(Color.Theme.divider)
                .frame(width: 50, height: 50)

              Image(systemName: "person.3.sequence.fill")
                .font(.system(size: 24))
                .foregroundColor(Color.Theme.textPrimary)
            }

            VStack(alignment: .leading, spacing: 6) {
              Text("Group Management")
                .font(.system(size: 28, weight: .bold, design: .monospaced))
                .foregroundColor(Color.Theme.textPrimary)

              HStack {
                Text("Manage your groups and members")
                  .font(.system(size: 14))
                  .foregroundColor(Color.Theme.textSecondary)

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
                      .font(.system(size: 12, design: .monospaced))
                      .foregroundColor(Color.Theme.textSecondary)
                  }
                case .error(let error):
                  Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundColor(Color.Theme.destructive)
                    .onTapGesture {
                      print("Sync Error: \(error)")
                    }
                case .offline:
                  Image(systemName: "wifi.slash")
                    .foregroundColor(Color.Theme.textTertiary)
                }
              }
            }

            Spacer()
          }
          .padding(20)
        }
        .background(
          RoundedRectangle(cornerRadius: 20)
            .fill(Color.Theme.searchBg)
            .overlay(
              RoundedRectangle(cornerRadius: 20)
                .stroke(Color.Theme.divider, lineWidth: 1)
            )
        )
        .adaptivePadding(horizontal: 20, vertical: 0)
        .padding(.top, 20)
        .padding(.bottom, 24)

        // Authentication Warning
        if !groupManager.isAuthenticated {
          HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
              .foregroundColor(Color.Theme.dustyMauve)

            VStack(alignment: .leading, spacing: 2) {
              Text("iCloud Sign-In Required")
                .font(.system(size: 14))
                .fontWeight(.semibold)
                .foregroundColor(Color.Theme.textPrimary)

              if case .couldNotDetermine = groupManager.accountStatus {
                Text("Could not determine iCloud status. Please check Settings.")
                  .font(.system(size: 12, design: .monospaced))
                  .foregroundColor(Color.Theme.textSecondary)
              } else if case .restricted = groupManager.accountStatus {
                Text("iCloud access is restricted.")
                  .font(.system(size: 12, design: .monospaced))
                  .foregroundColor(Color.Theme.textSecondary)
              } else if case .noAccount = groupManager.accountStatus {
                Text("Please sign in to iCloud in Settings.")
                  .font(.system(size: 12, design: .monospaced))
                  .foregroundColor(Color.Theme.textSecondary)
              } else {
                Text("Please sign in to iCloud in Settings to use group features.")
                  .font(.system(size: 12, design: .monospaced))
                  .foregroundColor(Color.Theme.textSecondary)
              }

              Button(action: {
                Task {
                  await groupManager.checkAccountStatus()
                }
              }) {
                Text("Retry")
                  .font(.system(size: 12, design: .monospaced))
                  .fontWeight(.bold)
                  .foregroundColor(Color.Theme.dustyMauve)
                  .padding(.top, 2)
              }
            }

            Spacer()
          }
          .padding(16)
          .background(Color.Theme.dustyMauve.opacity(0.15))
          .cornerRadius(12)
          .overlay(
            RoundedRectangle(cornerRadius: 12)
              .stroke(Color.Theme.dustyMauve.opacity(0.3), lineWidth: 1)
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
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundColor(Color.Theme.textPrimary)
                .padding(.horizontal, 20)
                .padding(.top, 8)

              VStack(spacing: 1) {
                SimpleNodeRow(
                  icon: "plus.circle.fill",
                  title: String(localized: "Create Group"),
                  subtitle: String(localized: "Create a new CloudKit group")
                )
                { activeSheet = .create }
                SimpleNodeRow(
                  icon: "link",
                  title: String(localized: "Invite via Link"),
                  subtitle: String(localized: "Generate invite link for members")
                ) {
                  activeSheet = .invite
                }
              }
            }
            .padding(4)
            .background(
              RoundedRectangle(cornerRadius: 16)
                .fill(Color.Theme.searchBg)
                .overlay(
                  RoundedRectangle(cornerRadius: 16)
                    .stroke(Color.Theme.divider, lineWidth: 1)
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
                .font(.system(size: 12, weight: .bold, design: .monospaced))
                .foregroundColor(Color.Theme.textPrimary)
                .padding(.horizontal, 20)
                .padding(.top, 8)

              VStack(spacing: 1) {
                SimpleNodeRow(
                  icon: "hand.raised",
                  title: String(localized: "Privacy Policy"),
                  subtitle: String(localized: "View our privacy policy")
                ) {
                  activeSheet = .privacy
                }
                SimpleNodeRow(
                  icon: "doc.text",
                  title: String(localized: "Terms of Service"),
                  subtitle: String(localized: "View terms of service")
                ) {
                  activeSheet = .terms
                }
              }
            }
            .padding(4)
            .background(
              RoundedRectangle(cornerRadius: 16)
                .fill(Color.Theme.searchBg)
                .overlay(
                  RoundedRectangle(cornerRadius: 16)
                    .stroke(Color.Theme.divider, lineWidth: 1)
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
            .foregroundColor(Color.Theme.textPrimary)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(
              Capsule()
                .fill(Color.Theme.searchBg)
                .background(
                  Capsule()
                    .stroke(Color.Theme.divider, lineWidth: 1)
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
    NavigationStack {
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
    NavigationStack {
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
