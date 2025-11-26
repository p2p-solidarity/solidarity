//
//  CreateGroupView.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import SwiftUI

struct CreateGroupView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var groupManager = SemaphoreGroupManager.shared
    @State private var groupName: String = ""
    @State private var isCreating: Bool = false
    
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Group Name", text: $groupName)
                        .textInputAutocapitalization(.words)
                } footer: {
                    Text("Give your group a recognizable name.")
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
        }
    }
    
    private func createGroup() {
        let name = groupName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        
        isCreating = true
        
        // Simulate network delay or processing if needed, but for local it's fast.
        // We'll add a small delay for better UX
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            groupManager.createGroup(name: name)
            isCreating = false
            dismiss()
        }
    }
}
