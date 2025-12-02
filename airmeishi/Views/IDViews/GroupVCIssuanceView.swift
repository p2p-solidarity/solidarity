//
//  GroupVCIssuanceView.swift
//  airmeishi
//
//  View for issuing Group VCs
//

import SwiftUI

struct GroupVCIssuanceView: View {
    let group: GroupModel
    @StateObject private var cardManager = CardManager.shared
    @StateObject private var groupService = GroupCredentialService.shared
    @StateObject private var deliveryService = GroupCredentialDeliveryService.shared
    @ObservedObject private var groupManager = CloudKitGroupSyncManager.shared
    
    @State private var selectedCard: BusinessCard?
    @State private var selectedMembers: Set<String> = []
    @State private var deliveryMethod: GroupCredentialDeliverySettings.DeliveryMethod = .sakura
    @State private var expirationDate: Date?
    @State private var isIssuing = false
    @State private var issuanceResults: [GroupCredentialResult] = []
    @State private var availableMembers: [GroupMemberModel] = []
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        NavigationView {
            Form {
                // Card Selection
                Section("Select Business Card") {
                    Picker("Card", selection: $selectedCard) {
                        Text("None").tag(nil as BusinessCard?)
                        ForEach(availableCards, id: \.id) { card in
                            Text(card.name).tag(card as BusinessCard?)
                        }
                    }
                }
                
                // Member Selection
                Section("Recipients") {
                    Toggle("Send to All Active Members", isOn: .init(
                        get: { selectedMembers.isEmpty },
                        set: { if $0 { selectedMembers = [] } }
                    ))
                    
                    if !selectedMembers.isEmpty {
                        // Show member selection list
                        List {
                            ForEach(availableMembers, id: \.userRecordID) { member in
                                Toggle(member.userRecordID, isOn: .init(
                                    get: { selectedMembers.contains(member.userRecordID) },
                                    set: {
                                        if $0 {
                                            selectedMembers.insert(member.userRecordID)
                                        } else {
                                            selectedMembers.remove(member.userRecordID)
                                        }
                                    }
                                ))
                            }
                        }
                    }
                }
                
                // Delivery Method
                Section("Delivery Method") {
                    Picker("Method", selection: $deliveryMethod) {
                        ForEach(GroupCredentialDeliverySettings.DeliveryMethod.allCases, id: \.self) { method in
                            Text(method.displayName).tag(method)
                        }
                    }
                }
                
                // Expiration (Optional)
                Section("Expiration (Optional)") {
                    Toggle("Set Expiration", isOn: .init(
                        get: { expirationDate != nil },
                        set: { expirationDate = $0 ? Calendar.current.date(byAdding: .day, value: 30, to: Date()) : nil }
                    ))
                    
                    if let expirationDate = expirationDate {
                        DatePicker("Expires", selection: .constant(expirationDate), displayedComponents: .date)
                    }
                }
                
                // Issue Button
                Section {
                    Button(action: issueCredential) {
                        HStack {
                            if isIssuing {
                                ProgressView()
                                    .padding(.trailing, 5)
                            }
                            Text("Issue Group Credential")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .disabled(selectedCard == nil || isIssuing)
                }
                
                // Results
                if !issuanceResults.isEmpty {
                    Section("Results") {
                        ForEach(issuanceResults.indices, id: \.self) { index in
                            let result = issuanceResults[index]
                            switch result {
                            case .success(let memberId, _):
                                Label("Sent to \(memberId)", systemImage: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                            case .failure(let memberId, let error):
                                Label("Failed: \(memberId) - \(error.localizedDescription)", systemImage: "xmark.circle.fill")
                                    .foregroundColor(.red)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Issue Group VC")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                availableMembers = (try? await groupManager.getMembers(for: group)) ?? []
            }
        }
    }
    
    private var availableCards: [BusinessCard] {
        (try? cardManager.getAllCards().get()) ?? []
    }
    
    private func issueCredential() {
        guard let card = selectedCard else { return }
        isIssuing = true
        
        Task {
            do {
                let targetMembers = selectedMembers.isEmpty ? nil : availableMembers.filter { selectedMembers.contains($0.userRecordID) }
                
                let results = try await groupService.issueGroupCredential(
                    for: card,
                    group: group,
                    targetMembers: targetMembers,
                    expiration: expirationDate
                )
                
                // Send via selected delivery method
                for result in results {
                    if case .success(let memberId, let credentialCard) = result {
                        try? await deliveryService.sendCredential(
                            credentialCard,
                            to: memberId,
                            via: deliveryMethod,
                            group: group
                        )
                    }
                }
                
                await MainActor.run {
                    issuanceResults = results
                    isIssuing = false
                }
            } catch {
                await MainActor.run {
                    isIssuing = false
                    // Show error (could add an error state var)
                    print("Error issuing credential: \(error)")
                }
            }
        }
    }
}
