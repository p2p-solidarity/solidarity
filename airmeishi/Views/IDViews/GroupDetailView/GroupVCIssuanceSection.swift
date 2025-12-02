//
//  GroupVCIssuanceSection.swift
//  airmeishi
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
                .font(.headline)
                .foregroundColor(.secondary)
            
            if canIssue {
                Button(action: { showIssuanceSheet = true }) {
                    Label("Issue New Group VC", systemImage: "doc.badge.plus")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.borderedProminent)
                
                if let summary = lastIssuanceSummary {
                    Text(summary)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            } else {
                HStack {
                    Image(systemName: "lock.fill")
                    .foregroundColor(.secondary)
                    Text("Only credential issuers can issue Group VCs")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(12)
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
