//
//  ShareLinkOptionsView.swift
//  airmeishi
//
//  Share link creation interface with usage limits and expiration controls
//

import SwiftUI

/// Share link creation view with customizable options
struct ShareLinkOptionsView: View {
    let businessCard: BusinessCard
    let sharingLevel: SharingLevel
    
    @StateObject private var shareLinkManager = ShareLinkManager.shared
    
    @State private var maxUses = 1
    @State private var expirationHours = 24
    @State private var createdLink: ShareLink?
    @State private var showingCreatedLink = false
    @State private var showingError = false
    @State private var errorMessage = ""
    
    @Environment(\.dismiss) private var dismiss
    
    private let maxUsesOptions = [1, 3, 5, 10, 25, 50]
    private let expirationOptions = [1, 6, 12, 24, 48, 72, 168] // hours
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    VStack(spacing: 12) {
                        Image(systemName: "link.circle")
                            .font(.system(size: 60))
                            .foregroundColor(.blue)
                        
                        Text("Create Share Link")
                            .font(.title2)
                            .fontWeight(.bold)
                        
                        Text("Generate a secure link that others can use to access your business card")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding()
                    
                    // Business card preview
                    BusinessCardSummary(
                        businessCard: businessCard.filteredCard(for: sharingLevel),
                        sharingLevel: sharingLevel
                    )
                    
                    // Link options
                    VStack(spacing: 20) {
                        // Max uses selector
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Maximum Uses")
                                .font(.headline)
                            
                            Text("How many times can this link be used?")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                            
                            LazyVGrid(columns: [
                                GridItem(.flexible()),
                                GridItem(.flexible()),
                                GridItem(.flexible())
                            ], spacing: 8) {
                                ForEach(maxUsesOptions, id: \.self) { uses in
                                    UsesOptionButton(
                                        uses: uses,
                                        isSelected: maxUses == uses
                                    ) {
                                        maxUses = uses
                                    }
                                }
                            }
                        }
                        
                        // Expiration selector
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Expiration Time")
                                .font(.headline)
                            
                            Text("When should this link expire?")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                            
                            LazyVGrid(columns: [
                                GridItem(.flexible()),
                                GridItem(.flexible())
                            ], spacing: 8) {
                                ForEach(expirationOptions, id: \.self) { hours in
                                    ExpirationOptionButton(
                                        hours: hours,
                                        isSelected: expirationHours == hours
                                    ) {
                                        expirationHours = hours
                                    }
                                }
                            }
                        }
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
                    
                    // Security notice
                    SecurityNoticeView()
                    
                    // Action buttons
                    VStack(spacing: 12) {
                        Button(action: createShareLink) {
                            HStack {
                                Image(systemName: "plus.circle.fill")
                                Text("Create Share Link")
                            }
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue)
                            .cornerRadius(12)
                        }
                        
                        Button("Cancel") {
                            dismiss()
                        }
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    }
                    .padding(.horizontal)
                }
                .padding()
            }
            .navigationTitle("Share Link")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .sheet(isPresented: $showingCreatedLink) {
            if let link = createdLink {
                CreatedLinkView(shareLink: link)
            }
        }
        .alert("Error", isPresented: $showingError) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
        }
    }
    
    // MARK: - Private Methods
    
    private func createShareLink() {
        let result = shareLinkManager.createShareLink(
            for: businessCard,
            sharingLevel: sharingLevel,
            maxUses: maxUses,
            expirationHours: expirationHours
        )
        
        switch result {
        case .success(let link):
            createdLink = link
            showingCreatedLink = true
        case .failure(let error):
            errorMessage = error.localizedDescription
            showingError = true
        }
    }
}

// MARK: - Business Card Summary

struct BusinessCardSummary: View {
    let businessCard: BusinessCard
    let sharingLevel: SharingLevel
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("What will be shared")
                    .font(.headline)
                
                Spacer()
                
                Text(sharingLevel.displayName)
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.blue.opacity(0.2))
                    .foregroundColor(.blue)
                    .cornerRadius(4)
            }
            
            VStack(alignment: .leading, spacing: 8) {
                SharedFieldRow(label: "Name", value: businessCard.name)
                
                if let title = businessCard.title {
                    SharedFieldRow(label: "Title", value: title)
                }
                
                if let company = businessCard.company {
                    SharedFieldRow(label: "Company", value: company)
                }
                
                if let email = businessCard.email {
                    SharedFieldRow(label: "Email", value: email)
                }
                
                if let phone = businessCard.phone {
                    SharedFieldRow(label: "Phone", value: phone)
                }
                
                if !businessCard.skills.isEmpty {
                    SharedFieldRow(
                        label: "Skills",
                        value: businessCard.skills.map { $0.name }.joined(separator: ", ")
                    )
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

struct SharedFieldRow: View {
    let label: String
    let value: String
    
    var body: some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundColor(.secondary)
                .frame(width: 60, alignment: .leading)
            
            Text(value)
                .font(.caption)
                .lineLimit(1)
            
            Spacer()
        }
    }
}

// MARK: - Option Buttons

struct UsesOptionButton: View {
    let uses: Int
    let isSelected: Bool
    let onTap: () -> Void
    
    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 4) {
                Text("\(uses)")
                    .font(.title3)
                    .fontWeight(.bold)
                
                Text(uses == 1 ? "use" : "uses")
                    .font(.caption2)
            }
            .foregroundColor(isSelected ? .white : .primary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(isSelected ? Color.blue : Color(.systemGray5))
            .cornerRadius(8)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

struct ExpirationOptionButton: View {
    let hours: Int
    let isSelected: Bool
    let onTap: () -> Void
    
    private var displayText: String {
        if hours < 24 {
            return "\(hours)h"
        } else {
            let days = hours / 24
            return "\(days)d"
        }
    }
    
    private var fullText: String {
        if hours < 24 {
            return hours == 1 ? "1 hour" : "\(hours) hours"
        } else {
            let days = hours / 24
            return days == 1 ? "1 day" : "\(days) days"
        }
    }
    
    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 4) {
                Text(displayText)
                    .font(.title3)
                    .fontWeight(.bold)
                
                Text(fullText)
                    .font(.caption2)
            }
            .foregroundColor(isSelected ? .white : .primary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(isSelected ? Color.blue : Color(.systemGray5))
            .cornerRadius(8)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - Security Notice

struct SecurityNoticeView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "shield.checkered")
                    .foregroundColor(.orange)
                
                Text("Security Notice")
                    .font(.headline)
                    .foregroundColor(.orange)
            }
            
            VStack(alignment: .leading, spacing: 8) {
                Text("• Links are encrypted and secure")
                Text("• You can deactivate links at any time")
                Text("• Links automatically expire after the set time")
                Text("• Usage is tracked and limited")
            }
            .font(.caption)
            .foregroundColor(.secondary)
        }
        .padding()
        .background(Color.orange.opacity(0.1))
        .cornerRadius(12)
    }
}

// MARK: - Created Link View

struct CreatedLinkView: View {
    let shareLink: ShareLink
    
    @Environment(\.dismiss) private var dismiss
    
    private var generatedShareURL: String {
        ShareLinkManager.shared.generateShareURL(for: shareLink)
    }
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Success header
                    VStack(spacing: 16) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 80))
                            .foregroundColor(.green)
                        
                        Text("Share Link Created!")
                            .font(.title2)
                            .fontWeight(.bold)
                        
                        Text("Your secure sharing link is ready to use")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    
                    // Link details
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Link Details")
                            .font(.headline)
                        
                        VStack(spacing: 12) {
                            LinkDetailRow(
                                icon: "link",
                                label: "Share URL",
                                value: generatedShareURL
                            )
                            
                            LinkDetailRow(
                                icon: "number",
                                label: "Max Uses",
                                value: "\(shareLink.maxUses)"
                            )
                            
                            LinkDetailRow(
                                icon: "clock",
                                label: "Expires",
                                value: shareLink.expirationDate.formatted(date: .abbreviated, time: .shortened)
                            )
                            
                            LinkDetailRow(
                                icon: "eye",
                                label: "Privacy Level",
                                value: shareLink.sharingLevel.displayName
                            )
                        }
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
                    
                    // Share options
                    VStack(spacing: 12) {
                        Button(action: shareLinkAction) {
                            HStack {
                                Image(systemName: "square.and.arrow.up")
                                Text("Share Link")
                            }
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue)
                            .cornerRadius(12)
                        }
                        
                        Button(action: copyLinkToClipboard) {
                            HStack {
                                Image(systemName: "doc.on.doc")
                                Text("Copy Link")
                            }
                            .font(.subheadline)
                            .foregroundColor(.blue)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue.opacity(0.1))
                            .cornerRadius(12)
                        }
                    }
                    
                    Spacer()
                }
                .padding()
            }
            .navigationTitle("Share Link Created")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
    
    // MARK: - Private Methods
    
    private func shareLinkAction() {
        let activityVC = UIActivityViewController(
            activityItems: [generatedShareURL],
            applicationActivities: nil
        )
        
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let window = windowScene.windows.first {
            window.rootViewController?.present(activityVC, animated: true)
        }
    }
    
    private func copyLinkToClipboard() {
        UIPasteboard.general.string = generatedShareURL
    }
}

struct LinkDetailRow: View {
    let icon: String
    let label: String
    let value: String
    
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundColor(.blue)
                .frame(width: 20)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                Text(value)
                    .font(.subheadline)
            }
            
            Spacer()
        }
    }
}

#Preview {
    ShareLinkOptionsView(
        businessCard: BusinessCard(
            name: "John Doe",
            title: "Software Engineer",
            company: "Tech Corp",
            email: "john@techcorp.com",
            phone: "+1 (555) 123-4567"
        ),
        sharingLevel: .professional
    )
}
