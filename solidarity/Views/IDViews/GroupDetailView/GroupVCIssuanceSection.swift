//
//  GroupVCIssuanceSection.swift
//  solidarity
//
//  Section for issuing Group VCs in GroupDetailView
//

import SwiftUI

struct GroupVCIssuanceSection: View {
  let group: GroupModel
  @ObservedObject private var groupManager = CloudKitGroupSyncManager.shared
  @StateObject private var cardManager = CardManager.shared
  @State private var selectedCard: BusinessCard?
  @State private var showIssuanceSheet = false

  @State private var lastIssuanceSummary: String?

  var canIssue: Bool {
    guard let currentUser = groupManager.currentUserRecordID else { return false }
    return group.canIssueCredentials(userRecordID: currentUser.recordName)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Issue Group Credential")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textSecondary)

      if canIssue {
        Button(action: { showIssuanceSheet = true }) {
          Label("Issue New Group VC", systemImage: "doc.badge.plus")
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
        }
        .buttonStyle(ThemedPrimaryButtonStyle())

        if let summary = lastIssuanceSummary {
          Text(summary)
            .font(.system(size: 12, design: .monospaced))
            .foregroundColor(Color.Theme.textTertiary)
        }
      } else {
        HStack {
          Image(systemName: "lock.fill")
            .foregroundColor(Color.Theme.textTertiary)
          Text("Only credential issuers can issue Group VCs")
            .font(.system(size: 14))
            .foregroundColor(Color.Theme.textSecondary)
        }
      }
    }
    .padding(16)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    .sheet(isPresented: $showIssuanceSheet) {
      GroupVCIssuanceView(group: group)
    }
    .onReceive(NotificationCenter.default.publisher(for: .groupVCIssuanceDidComplete)) { notification in
      if let summary = notification.userInfo?["summary"] as? String {
        lastIssuanceSummary = summary
      }
    }
  }
}
