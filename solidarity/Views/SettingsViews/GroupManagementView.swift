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
        ScrollView {
          VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 12) {
              Image(systemName: "person.3.sequence.fill")
                .font(.system(size: 18, weight: .regular))
                .foregroundColor(Color.Theme.textPrimary)
                .frame(width: 32)

              VStack(alignment: .leading, spacing: 4) {
                Text("Group Management")
                  .font(.system(size: 18, weight: .semibold))
                  .foregroundColor(Color.Theme.textPrimary)

                switch groupManager.syncStatus {
                case .idle:
                  EmptyView()
                case .syncing:
                  HStack(spacing: 4) {
                    ProgressView()
                      .scaleEffect(0.5)
                    Text("Syncing...")
                      .font(.system(size: 12))
                      .foregroundColor(Color.Theme.textSecondary)
                  }
                case .error(let error):
                  HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.triangle.fill")
                      .font(.system(size: 11))
                      .foregroundColor(Color.Theme.destructive)
                    Text("Sync error")
                      .font(.system(size: 12))
                      .foregroundColor(Color.Theme.destructive)
                  }
                  .onTapGesture {
                    print("Sync Error: \(error)")
                  }
                case .offline:
                  HStack(spacing: 4) {
                    Image(systemName: "wifi.slash")
                      .font(.system(size: 11))
                      .foregroundColor(Color.Theme.textTertiary)
                    Text("Offline")
                      .font(.system(size: 12))
                      .foregroundColor(Color.Theme.textTertiary)
                  }
                }
              }

              Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 14)
            .background(
              RoundedRectangle(cornerRadius: 12)
                .fill(Color.Theme.mutedSurface)
            )
            .padding(.horizontal, 16)
            .padding(.top, 8)

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
                      .font(.system(size: 12))
                      .foregroundColor(Color.Theme.textSecondary)
                  } else if case .restricted = groupManager.accountStatus {
                    Text("iCloud access is restricted.")
                      .font(.system(size: 12))
                      .foregroundColor(Color.Theme.textSecondary)
                  } else if case .noAccount = groupManager.accountStatus {
                    Text("Please sign in to iCloud in Settings.")
                      .font(.system(size: 12))
                      .foregroundColor(Color.Theme.textSecondary)
                  } else {
                    Text("Please sign in to iCloud in Settings to use group features.")
                      .font(.system(size: 12))
                      .foregroundColor(Color.Theme.textSecondary)
                  }

                  Button(action: {
                    Task {
                      await groupManager.checkAccountStatus()
                    }
                  }) {
                    Text("Retry")
                      .font(.system(size: 12))
                      .fontWeight(.semibold)
                      .foregroundColor(Color.Theme.dustyMauve)
                      .padding(.top, 2)
                  }
                }

                Spacer()
              }
              .padding(14)
              .background(
                RoundedRectangle(cornerRadius: 12)
                  .fill(Color.Theme.dustyMauve.opacity(0.12))
              )
              .padding(.horizontal, 16)
            }

            SettingsBlockSection("Actions") {
              Button { activeSheet = .create } label: {
                SettingsBlockRow(
                  icon: "plus.circle.fill",
                  title: String(localized: "Create Group"),
                  subtitle: String(localized: "Create a new CloudKit group")
                )
              }
              .buttonStyle(.plain)

              Button { activeSheet = .invite } label: {
                SettingsBlockRow(
                  icon: "link",
                  title: String(localized: "Invite via Link"),
                  subtitle: String(localized: "Generate invite link for members")
                )
              }
              .buttonStyle(.plain)
            }

            YourGroupsSectionView(
              groupManager: groupManager,
              selectedGroupToDelete: $selectedGroupToDelete,
              showDeleteConfirm: $showDeleteConfirm
            )

            SettingsBlockSection("Legal & Privacy") {
              Button { activeSheet = .privacy } label: {
                SettingsBlockRow(
                  icon: "hand.raised",
                  title: String(localized: "Privacy Policy"),
                  subtitle: String(localized: "View our privacy policy")
                )
              }
              .buttonStyle(.plain)

              Button { activeSheet = .terms } label: {
                SettingsBlockRow(
                  icon: "doc.text",
                  title: String(localized: "Terms of Service"),
                  subtitle: String(localized: "View terms of service")
                )
              }
              .buttonStyle(.plain)
            }
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
            HStack(spacing: 4) {
              Image(systemName: "chevron.left")
                .font(.system(size: 16, weight: .semibold))
              Text("Done")
                .font(.system(size: 16))
            }
            .foregroundColor(Color.Theme.textPrimary)
            .padding(.horizontal, 4)
            .padding(.vertical, 8)
          }
          Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
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
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("Privacy Policy")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        SettingsBackToolbar { activeSheet = nil }
      }
    }
  }

  private var termsSheet: some View {
    NavigationStack {
      ScrollView {
        Text("Terms of Service Content...")
          .padding()
      }
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("Terms of Service")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        SettingsBackToolbar { activeSheet = nil }
      }
    }
  }
}
