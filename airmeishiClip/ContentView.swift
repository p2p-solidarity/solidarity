//
//  ContentView.swift
//  airmeishiClip
//
//  Main view for App Clip showing shared business card with verification
//

import SwiftUI
import Contacts
import UIKit

/// Main content view for the App Clip
struct ContentView: View {
    @StateObject private var viewModel = AppClipViewModel()
    @State private var showingAddToContacts = false
    @State private var showingFullApp = false
    
    var body: some View {
        NavigationView {
            Group {
                switch viewModel.state {
                case .loading:
                    loadingView
                    
                case .loaded(let card):
                    businessCardView(card)
                    
                case .error(let message):
                    errorView(message)
                    
                case .notFound:
                    notFoundView
                }
            }
            .navigationTitle("Business Card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Get App") {
                        showingFullApp = true
                    }
                }
            }
        }
        .sheet(isPresented: $showingAddToContacts) {
            if case .loaded(let card) = viewModel.state {
                addToContactsSheet(card)
            }
        }
        .sheet(isPresented: $showingFullApp) {
            fullAppPromotionSheet
        }
        .onOpenURL { url in
            viewModel.handleIncomingURL(url)
        }
        .onAppear {
            // Handle URL if app was launched with one
            if let url = viewModel.pendingURL {
                viewModel.handleIncomingURL(url)
            }
        }
    }
    
    // MARK: - Loading View
    
    private var loadingView: some View {
        VStack(spacing: 20) {
            ProgressView()
                .scaleEffect(1.5)
            
            Text("Loading business card...")
                .font(.headline)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    
    // MARK: - Business Card View
    
    private func businessCardView(_ card: BusinessCard) -> some View {
        ScrollView {
            VStack(spacing: 24) {
                // Profile section
                profileSection(card)
                
                // Contact information
                contactInfoSection(card)
                
                // Skills section
                if !card.skills.isEmpty {
                    skillsSection(card)
                }
                
                // Verification status
                verificationSection
                
                // Action buttons
                actionButtonsSection(card)
                
                // App promotion
                appPromotionSection
            }
            .padding()
        }
    }
    
    private func profileSection(_ card: BusinessCard) -> some View {
        VStack(spacing: 16) {
            // Profile image or placeholder
            Group {
                if let imageData = card.profileImage,
                   let uiImage = UIImage(data: imageData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else {
                    Image(systemName: "person.circle.fill")
                        .font(.system(size: 80))
                        .foregroundColor(.gray)
                }
            }
            .frame(width: 100, height: 100)
            .clipShape(Circle())
            
            // Name and title
            VStack(spacing: 4) {
                Text(card.name)
                    .font(.title)
                    .fontWeight(.bold)
                
                if let title = card.title {
                    Text(title)
                        .font(.headline)
                        .foregroundColor(.secondary)
                }
                
                if let company = card.company {
                    Text(company)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(16)
    }
    
    private func contactInfoSection(_ card: BusinessCard) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Contact Information")
                .font(.headline)
            
            VStack(spacing: 8) {
                if let email = card.email, !email.isEmpty {
                    contactInfoRow(icon: "envelope", title: "Email", value: email) {
                        openEmail(email)
                    }
                }
                
                if let phone = card.phone, !phone.isEmpty {
                    contactInfoRow(icon: "phone", title: "Phone", value: phone) {
                        openPhone(phone)
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(16)
    }
    
    private func contactInfoRow(icon: String, title: String, value: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Image(systemName: icon)
                    .frame(width: 20)
                    .foregroundColor(.blue)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    Text(value)
                        .font(.body)
                        .foregroundColor(.primary)
                }
                
                Spacer()
                
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
    }
    
    private func skillsSection(_ card: BusinessCard) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Skills & Expertise")
                .font(.headline)
            
            LazyVGrid(columns: [
                GridItem(.adaptive(minimum: 120))
            ], spacing: 8) {
                ForEach(card.skills) { skill in
                    skillBadge(skill)
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(16)
    }
    
    private func skillBadge(_ skill: Skill) -> some View {
        VStack(spacing: 4) {
            Text(skill.name)
                .font(.caption)
                .fontWeight(.medium)
            
            Text(skill.proficiencyLevel.rawValue)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.blue.opacity(0.1))
        .foregroundColor(.blue)
        .cornerRadius(8)
    }
    
    private var verificationSection: some View {
        HStack {
            Image(systemName: viewModel.verificationStatus.systemImageName)
                .foregroundColor(Color(viewModel.verificationStatus.color))
            
            Text(viewModel.verificationStatus.displayName)
                .font(.subheadline)
                .foregroundColor(Color(viewModel.verificationStatus.color))
            
            Spacer()
            
            if viewModel.verificationStatus == .verified {
                Text("Cryptographically Verified")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
    
    private func actionButtonsSection(_ card: BusinessCard) -> some View {
        VStack(spacing: 12) {
            // Add to Contacts button
            Button(action: { showingAddToContacts = true }) {
                HStack {
                    Image(systemName: "person.badge.plus")
                    Text("Add to Contacts")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            
            // Share button
            Button(action: { shareCard(card) }) {
                HStack {
                    Image(systemName: "square.and.arrow.up")
                    Text("Share")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
    }
    
    private var appPromotionSection: some View {
        VStack(spacing: 12) {
            Text("Get the Full App")
                .font(.headline)
            
            Text("Create your own digital business cards and share them securely with privacy controls.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            
            Button("Download Airmeishi") {
                showingFullApp = true
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
        .background(Color.blue.opacity(0.1))
        .cornerRadius(16)
    }
    
    // MARK: - Error Views
    
    private func errorView(_ message: String) -> some View {
        VStack(spacing: 20) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 50))
                .foregroundColor(.orange)
            
            Text("Error")
                .font(.title)
                .fontWeight(.bold)
            
            Text(message)
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            
            Button("Try Again") {
                viewModel.retry()
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    
    private var notFoundView: some View {
        VStack(spacing: 20) {
            Image(systemName: "questionmark.circle")
                .font(.system(size: 50))
                .foregroundColor(.gray)
            
            Text("Card Not Found")
                .font(.title)
                .fontWeight(.bold)
            
            Text("The business card you're looking for could not be found or may have expired.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            
            Button("Get the App") {
                showingFullApp = true
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    
    // MARK: - Sheets
    
    private func addToContactsSheet(_ card: BusinessCard) -> some View {
        NavigationView {
            VStack(spacing: 20) {
                Text("Add to Contacts")
                    .font(.title2)
                    .fontWeight(.semibold)
                
                Text("This will add \(card.name) to your device contacts.")
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                
                Button("Add Contact") {
                    addToContacts(card)
                }
                .buttonStyle(.borderedProminent)
                
                Spacer()
            }
            .padding()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Cancel") {
                        showingAddToContacts = false
                    }
                }
            }
        }
    }
    
    private var fullAppPromotionSheet: some View {
        NavigationView {
            VStack(spacing: 24) {
                Image(systemName: "app.badge")
                    .font(.system(size: 60))
                    .foregroundColor(.blue)
                
                Text("Get Airmeishi")
                    .font(.title)
                    .fontWeight(.bold)
                
                Text("Create and share your own digital business cards with advanced privacy controls and cryptographic verification.")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                
                VStack(alignment: .leading, spacing: 12) {
                    featureRow(icon: "shield.checkered", title: "Privacy First", description: "Control what you share")
                    featureRow(icon: "qrcode", title: "QR Sharing", description: "Quick and secure sharing")
                    featureRow(icon: "wallet.pass", title: "Apple Wallet", description: "Integrated with Wallet app")
                    featureRow(icon: "wave.3.right", title: "Proximity Sharing", description: "Share with nearby devices")
                }
                
                Button("Download from App Store") {
                    openAppStore()
                }
                .buttonStyle(.borderedProminent)
                
                Spacer()
            }
            .padding()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        showingFullApp = false
                    }
                }
            }
        }
    }
    
    private func featureRow(icon: String, title: String, description: String) -> some View {
        HStack {
            Image(systemName: icon)
                .frame(width: 24)
                .foregroundColor(.blue)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                
                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
        }
    }
    
    // MARK: - Actions
    
    private func openEmail(_ email: String) {
        if let url = URL(string: "mailto:\(email)") {
            UIApplication.shared.open(url)
        }
    }
    
    private func openPhone(_ phone: String) {
        let cleanPhone = phone.components(separatedBy: CharacterSet.decimalDigits.inverted).joined()
        if let url = URL(string: "tel:\(cleanPhone)") {
            UIApplication.shared.open(url)
        }
    }
    
    private func shareCard(_ card: BusinessCard) {
        // Create share content
        let shareText = "Business Card: \(card.name)"
        let activityVC = UIActivityViewController(activityItems: [shareText], applicationActivities: nil)
        
        // Present share sheet
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let window = windowScene.windows.first,
           let rootViewController = window.rootViewController {
            
            if let popover = activityVC.popoverPresentationController {
                popover.sourceView = window
                popover.sourceRect = CGRect(x: window.bounds.midX, y: window.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            
            rootViewController.present(activityVC, animated: true)
        }
    }
    
    private func addToContacts(_ card: BusinessCard) {
        let contact = CNMutableContact()
        
        // Set name
        let nameComponents = card.name.components(separatedBy: " ")
        if !nameComponents.isEmpty {
            contact.givenName = nameComponents[0]
            if nameComponents.count > 1 {
                contact.familyName = nameComponents.dropFirst().joined(separator: " ")
            }
        }
        
        // Set job title and organization
        if let title = card.title {
            contact.jobTitle = title
        }
        
        if let company = card.company {
            contact.organizationName = company
        }
        
        // Set email
        if let email = card.email {
            let emailAddress = CNLabeledValue(label: CNLabelWork, value: email as NSString)
            contact.emailAddresses = [emailAddress]
        }
        
        // Set phone
        if let phone = card.phone {
            let phoneNumber = CNLabeledValue(label: CNLabelWork, value: CNPhoneNumber(stringValue: phone))
            contact.phoneNumbers = [phoneNumber]
        }
        
        // Set profile image
        if let imageData = card.profileImage {
            contact.imageData = imageData
        }
        
        // Save to contacts
        let store = CNContactStore()
        let saveRequest = CNSaveRequest()
        saveRequest.add(contact, toContainerWithIdentifier: nil)
        
        do {
            try store.execute(saveRequest)
            showingAddToContacts = false
            
            // Show success feedback
            let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
            impactFeedback.impactOccurred()
            
        } catch {
            print("Failed to save contact: \(error)")
            // Handle error - could show an alert
        }
    }
    
    private func openAppStore() {
        // In a real app, this would open the App Store page
        if let url = URL(string: "https://apps.apple.com/app/airmeishi") {
            UIApplication.shared.open(url)
        }
    }
}

// MARK: - Preview

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}