//
//  CreateGroupView.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import SwiftUI

struct CreateGroupView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var groupManager = CloudKitGroupSyncManager.shared
    @State private var groupName: String = ""
    @State private var groupDescription: String = ""
    @State private var isPrivate: Bool = false
    @State private var isCreating: Bool = false
    @State private var errorMessage: String?
    @State private var showingError: Bool = false
    
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Group Name", text: $groupName)
                        .textInputAutocapitalization(.words)
                    
                    TextField("Description (Optional)", text: $groupDescription)
                        .textInputAutocapitalization(.sentences)
                } footer: {
                    Text("Give your group a recognizable name and description.")
                }
                
                Section {
                    Picker("Group Type", selection: $isPrivate) {
                        Text("Public Group").tag(false)
                        Text("Private Group").tag(true)
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    if isPrivate {
                        Text("Private groups use native iCloud Sharing. Only invited people can join.")
                    } else {
                        Text("Public groups use simple link sharing. Anyone with the link can join.")
                    }
                }
                
                Section {
                    Button(action: createGroup) {
                        if isCreating {
                            HStack {
                                Text("Creating...")
                                Spacer()
                                ProgressView()
                            }
                        } else {
                            Text("Create Group")
                        }
                    }
                    .disabled(groupName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isCreating)
                }
            }
            .navigationTitle("New Group")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .alert("Error", isPresented: $showingError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "Unknown error")
            }
        }
    }
    
    private func createGroup() {
        let name = groupName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        
        isCreating = true
        
        Task {
            do {
                _ = try await groupManager.createGroup(name: name, description: groupDescription, coverImage: nil, isPrivate: isPrivate)
                await MainActor.run {
                    isCreating = false
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showingError = true
                    isCreating = false
                }
            }
        }
    }
}
