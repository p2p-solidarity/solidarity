//
//  QRSharingView.swift
//  airmeishi
//
//  QR code sharing interface with privacy controls and Apple Wallet integration
//

import SwiftUI

/// QR code sharing view with privacy controls and sharing options
struct QRSharingView: View {
    let businessCard: BusinessCard
    
    @StateObject private var qrManager = QRCodeManager.shared
    @StateObject private var passKitManager = PassKitManager.shared
    @StateObject private var shareLinkManager = ShareLinkManager.shared
    
    @State private var selectedSharingLevel: SharingLevel = .professional
    @State private var generatedQRImage: UIImage?
    @State private var showingShareSheet = false
    @State private var showingError = false
    @State private var errorMessage = ""
    @State private var showingPassGeneration = false
    @State private var showingLinkOptions = false
    @State private var qrMode: QRShareMode = .oidc
    @State private var oidcContext: OIDCService.PresentationRequestContext?
    
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Business card preview
                    BusinessCardPreview(
                        businessCard: businessCard.filteredCard(for: selectedSharingLevel)
                    )
                    




                    
                    // QR Code display
                    QRCodeDisplay(
                        qrImage: generatedQRImage,
                        isGenerating: qrManager.isGenerating
                    )

                    if qrMode == .oidc, let context = oidcContext {
                        OIDCRequestSummary(context: context)
                    }
                    
                    // Sharing options
                    SharingOptionsView(
                        onGenerateQR: generateQRCode,
                        onCreateWalletPass: createWalletPass,
                        onCreateShareLink: createShareLink,
                        onShowShareSheet: { showingShareSheet = true }
                    )
                    
                    // Privacy level selector
                    PrivacyLevelSelector(
                        selectedLevel: $selectedSharingLevel,
                        businessCard: businessCard
                    )

                    // Sharing mode selector
                    SharingModeSelector(selectedMode: $qrMode)
                        .onChange(of: qrMode) { _, _ in
                            generateQRCode()
                        }
                    
                    // Active share links
                    ActiveShareLinksView(
                        businessCardId: businessCard.id,
                        shareLinkManager: shareLinkManager
                    )
                }
                .padding()
            }
            .navigationTitle("Share Business Card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
        .onAppear {
            generateQRCode()
        }
        .onChange(of: selectedSharingLevel) { _, _ in
            generateQRCode()
        }
        .sheet(isPresented: $showingShareSheet) {
            if let qrImage = generatedQRImage {
                ShareSheet(items: [qrImage])
            }
        }
        .sheet(isPresented: $showingPassGeneration) {
            WalletPassGenerationView(
                businessCard: businessCard,
                sharingLevel: selectedSharingLevel
            )
        }
        .sheet(isPresented: $showingLinkOptions) {
            ShareLinkOptionsView(
                businessCard: businessCard,
                sharingLevel: selectedSharingLevel
            )
        }
        .alert("Error", isPresented: $showingError) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
        }
    }
    
    // MARK: - Private Methods
    
    private func generateQRCode() {
        switch qrMode {
        case .direct:
            generateDirectQRCode()
        case .oidc:
            generateOIDCRequestQRCode()
        }
    }
    
    private func createWalletPass() {
        showingPassGeneration = true
    }
    
    private func createShareLink() {
        showingLinkOptions = true
    }

    private func generateDirectQRCode() {
        let result = qrManager.generateQRCode(
            for: businessCard,
            sharingLevel: selectedSharingLevel
        )

        switch result {
        case .success(let image):
            generatedQRImage = image
            oidcContext = nil
        case .failure(let error):
            errorMessage = error.localizedDescription
            showingError = true
        }
    }

    private func generateOIDCRequestQRCode() {
        let result = OIDCService.shared.createPresentationRequest()

        switch result {
        case .failure(let error):
            errorMessage = error.localizedDescription
            showingError = true
        case .success(let context):
            oidcContext = context
            let qrResult = qrManager.generateQRCode(from: context.qrString)
            switch qrResult {
            case .success(let image):
                generatedQRImage = image
            case .failure(let error):
                errorMessage = error.localizedDescription
                showingError = true
            }
        }
    }
}

// MARK: - Business Card Preview

struct BusinessCardPreview: View {
    let businessCard: BusinessCard
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Preview")
                .font(.headline)
                .foregroundColor(.secondary)
            
            VStack(alignment: .leading, spacing: 8) {
                Text(businessCard.name)
                    .font(.title2)
                    .fontWeight(.bold)
                
                if let title = businessCard.title {
                    Text(title)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                
                if let company = businessCard.company {
                    Text(company)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                
                if let email = businessCard.email {
                    Text(email)
                        .font(.caption)
                        .foregroundColor(.blue)
                }
                
                if let phone = businessCard.phone {
                    Text(phone)
                        .font(.caption)
                        .foregroundColor(.blue)
                }
                
                if !businessCard.skills.isEmpty {
                    Text("Skills: \(businessCard.skills.map { $0.name }.joined(separator: ", "))")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(12)
        }
    }
}

// MARK: - Privacy Level Selector

struct PrivacyLevelSelector: View {
    @Binding var selectedLevel: SharingLevel
    let businessCard: BusinessCard
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Privacy Level")
                .font(.headline)
            
            VStack(spacing: 8) {
                ForEach(SharingLevel.allCases, id: \.self) { level in
                    PrivacyLevelRow(
                        level: level,
                        isSelected: selectedLevel == level,
                        fieldCount: businessCard.sharingPreferences.fieldsForLevel(level).count
                    ) {
                        selectedLevel = level
                    }
                }
            }
        }
    }
}

struct PrivacyLevelRow: View {
    let level: SharingLevel
    let isSelected: Bool
    let fieldCount: Int
    let onTap: () -> Void
    
    var body: some View {
        Button(action: onTap) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(level.displayName)
                        .font(.subheadline)
                        .fontWeight(.medium)
                    
                    Text("\(fieldCount) fields shared")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.blue)
                }
            }
            .padding()
            .background(isSelected ? Color.blue.opacity(0.1) : Color(.systemGray6))
            .cornerRadius(8)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

enum QRShareMode: Int {
    case oidc
    case direct
}

struct SharingModeSelector: View {
    @Binding var selectedMode: QRShareMode

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sharing Mode")
                .font(.headline)

            Picker("Sharing Mode", selection: $selectedMode) {
                Text("Request VC (OIDC)").tag(QRShareMode.oidc)
                Text("Share Direct VC").tag(QRShareMode.direct)
            }
            .pickerStyle(SegmentedPickerStyle())
        }
    }
}

// MARK: - QR Code Display

struct QRCodeDisplay: View {
    let qrImage: UIImage?
    let isGenerating: Bool
    
    var body: some View {
        VStack(spacing: 12) {
            Text("QR Code")
                .font(.headline)
            
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.white)
                    .frame(width: 200, height: 200)
                    .shadow(radius: 4)
                
                if isGenerating {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle())
                } else if let qrImage = qrImage {
                    Image(uiImage: qrImage)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 180, height: 180)
                } else {
                    VStack {
                        Image(systemName: "qrcode")
                            .font(.system(size: 40))
                            .foregroundColor(.gray)
                        
                        Text("QR Code")
                            .font(.caption)
                            .foregroundColor(.gray)
                    }
                }
            }
        }
    }
}

struct OIDCRequestSummary: View {
    let context: OIDCService.PresentationRequestContext

    private var relativeFormatter: RelativeDateTimeFormatter {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("OIDC Request Details")
                .font(.headline)

            VStack(alignment: .leading, spacing: 4) {
                Text("State: \(context.request.state)")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Text("Nonce: \(context.request.nonce)")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Text("Generated \(relativeFormatter.localizedString(for: context.createdAt, relativeTo: Date()))")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(8)

            Text("Ask the other wallet to scan this code to send back a verifiable business card.")
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - Sharing Options

struct SharingOptionsView: View {
    let onGenerateQR: () -> Void
    let onCreateWalletPass: () -> Void
    let onCreateShareLink: () -> Void
    let onShowShareSheet: () -> Void
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sharing Options")
                .font(.headline)
            
            VStack(spacing: 8) {
                SharingOptionButton(
                    icon: "qrcode",
                    title: "Regenerate QR Code",
                    subtitle: "Create new QR code with current settings",
                    action: onGenerateQR
                )
                
                SharingOptionButton(
                    icon: "wallet.pass",
                    title: "Add to Apple Wallet",
                    subtitle: "Create Apple Wallet pass",
                    action: onCreateWalletPass
                )
                
                SharingOptionButton(
                    icon: "link",
                    title: "Create Share Link",
                    subtitle: "Generate one-time sharing link",
                    action: onCreateShareLink
                )
                
                SharingOptionButton(
                    icon: "square.and.arrow.up",
                    title: "Share QR Code",
                    subtitle: "Share via AirDrop, Messages, etc.",
                    action: onShowShareSheet
                )
            }
        }
    }
}

struct SharingOptionButton: View {
    let icon: String
    let title: String
    let subtitle: String
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.title2)
                    .foregroundColor(.blue)
                    .frame(width: 30)
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)
                    
                    Text(subtitle)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(8)
        }
        .buttonStyle(PlainButtonStyle())
    }
}

// MARK: - Active Share Links

struct ActiveShareLinksView: View {
    let businessCardId: UUID
    @ObservedObject var shareLinkManager: ShareLinkManager
    
    private var activeLinks: [ShareLink] {
        shareLinkManager.getActiveLinks(for: businessCardId)
    }
    
    var body: some View {
        if !activeLinks.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("Active Share Links")
                    .font(.headline)
                
                VStack(spacing: 8) {
                    ForEach(activeLinks) { link in
                        ShareLinkRow(
                            shareLink: link,
                            onDeactivate: {
                                _ = shareLinkManager.deactivateLink(link.id)
                            }
                        )
                    }
                }
            }
        }
    }
}

struct ShareLinkRow: View {
    let shareLink: ShareLink
    let onDeactivate: () -> Void
    
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Share Link")
                    .font(.subheadline)
                    .fontWeight(.medium)
                
                Text("\(shareLink.remainingUses) uses remaining")
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                Text("Expires: \(shareLink.expirationDate, style: .relative)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            Button("Deactivate") {
                onDeactivate()
            }
            .font(.caption)
            .foregroundColor(.red)
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(8)
    }
}

// MARK: - Share Sheet

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

#Preview {
    QRSharingView(
        businessCard: BusinessCard(
            name: "John Doe",
            title: "Software Engineer",
            company: "Tech Corp",
            email: "john@techcorp.com",
            phone: "+1 (555) 123-4567"
        )
    )
}