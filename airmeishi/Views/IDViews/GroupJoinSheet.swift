//
//  GroupJoinSheet.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import SwiftUI

struct GroupJoinSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var groupManager = CloudKitGroupSyncManager.shared
    
    @State private var inviteToken: String = ""
    @State private var isJoining = false
    @State private var errorMessage: String?
    @State private var successMessage: String?
    
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Enter Invite Token", text: $inviteToken)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("Invite Token")
                } footer: {
                    Text("Enter the token shared with you to join a private or public group.")
                }
                
                if let error = errorMessage {
                    Section {
                        Text(error)
                            .foregroundColor(.red)
                    }
                }
                
                if let success = successMessage {
                    Section {
                        Text(success)
                            .foregroundColor(.green)
                    }
                }
                
                Section {
                    Button(action: {
                        joinGroup()
                    }, label: {
                        if isJoining {
                            HStack {
                                Text("Joining...")
                                Spacer()
                                ProgressView()
                            }
                        } else {
                            Text("Join Group")
                        }
                    })
                    .disabled(inviteToken.isEmpty || isJoining)
                }
                Section {
                    Button(action: {
                        showingScanner = true
                    }, label: {
                        Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                    })
                }
            }
            .navigationTitle("Join Group")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .sheet(isPresented: $showingScanner) {
                SimpleQRScannerView(onScan: { code in
                    showingScanner = false
                    handleScannedCode(code)
                }, onCancel: {
                    showingScanner = false
                })
            }
        }
    }
    
    @State private var showingScanner = false
    
    private func handleScannedCode(_ code: String) {
        // Expected format: airmeishi://group/join?token=XYZ
        if let url = URL(string: code),
           let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
           let queryItems = components.queryItems,
           let token = queryItems.first(where: { $0.name == "token" })?.value {
            
            inviteToken = token
            // Auto-join? Or just fill? Let's fill for safety.
            // joinGroup()
        } else {
            errorMessage = "Invalid QR Code format"
        }
    }
    
    private func joinGroup() {
        guard !inviteToken.isEmpty else { return }
        
        isJoining = true
        errorMessage = nil
        successMessage = nil
        
        Task {
            do {
                let group = try await groupManager.joinGroup(withInviteToken: inviteToken)
                await MainActor.run {
                    isJoining = false
                    successMessage = "Successfully joined \(group.name)!"
                    // Delay dismissal to show success message
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                        dismiss()
                    }
                }
            } catch {
                await MainActor.run {
                    isJoining = false
                    errorMessage = "Failed to join: \(error.localizedDescription)"
                }
            }
        }
    }
}

#Preview {
    GroupJoinSheet()
}
