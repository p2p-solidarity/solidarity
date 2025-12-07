//
//  SettingsView.swift
//  airmeishi
//
//  Main settings view that consolidates all app settings
//

import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var theme: ThemeManager
    @StateObject private var cardManager = CardManager.shared
    @State private var showingAppearanceSettings = false
    @State private var showingBackupSettings = false
    @State private var showingPrivacySettings = false
    @State private var showingGroupManagement = false
    @State private var showingZKSettings = false
    
    var body: some View {
        NavigationStack {
            Form {
                Section("Appearance") {
                    NavigationLink {
                        AppearanceSettingsView()
                    } label: {
                        Label("Card Appearance", systemImage: "paintbrush.fill")
                    }
                }
                
                Section("Privacy & Security") {
                    if let card = cardManager.businessCards.first {
                        let cardId = card.id
                        let sharingBinding = Binding(
                            get: {
                                if let currentCard = cardManager.businessCards.first(where: { $0.id == cardId }) {
                                    return currentCard.sharingPreferences
                                }
                                return card.sharingPreferences
                            },
                            set: { newPreferences in
                                if var updatedCard = cardManager.businessCards.first(where: { $0.id == cardId }) {
                                    updatedCard.sharingPreferences = newPreferences
                                    _ = cardManager.updateCard(updatedCard)
                                }
                            }
                        )
                        
                        NavigationLink {
                            PrivacySettingsView(sharingPreferences: sharingBinding)
                        } label: {
                            Label("Privacy Settings", systemImage: "lock.shield.fill")
                        }
                    } else {
                        Text("Please create a card to configure privacy settings")
                            .foregroundColor(.secondary)
                    }
                }
                
                Section("Data") {
                    NavigationLink {
                        BackupSettingsView()
                    } label: {
                        Label("Backup & Restore", systemImage: "icloud.fill")
                    }
                    
                    NavigationLink {
                        VCSettingsView()
                    } label: {
                        Label("VC Management", systemImage: "doc.text.fill")
                    }
                }
                
                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Unknown")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}

#Preview {
    SettingsView()
        .environmentObject(ThemeManager.shared)
}

