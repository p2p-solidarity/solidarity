//
//  SettingsView.swift
//  airmeishi
//
//  Main settings view that consolidates all app settings
//

import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var theme: ThemeManager
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
                    NavigationLink {
                        PrivacySettingsView(sharingPreferences: .constant(SharingPreferences()))
                    } label: {
                        Label("Privacy Settings", systemImage: "lock.shield.fill")
                    }
                    
                    NavigationLink {
                        SelectiveDisclosureSettingsView(sharingPreferences: .constant(SharingPreferences()))
                            .navigationTitle("ZK Settings")
                    } label: {
                        Label("ZK Settings", systemImage: "eye.slash.fill")
                    }
                }
                
                Section("Groups") {
                    NavigationLink {
                        GroupManagementView()
                    } label: {
                        Label("Group Management", systemImage: "person.3.fill")
                    }
                }
                
                Section("Data") {
                    NavigationLink {
                        BackupSettingsView()
                    } label: {
                        Label("Backup & Restore", systemImage: "icloud.fill")
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

