//
//  QRScannerView.swift
//  airmeishi
//
//  QR code scanner interface with camera preview and scan results
//

import SwiftUI
import AVFoundation
import UIKit

/// QR code scanner view with camera preview and scan handling
struct QRScannerView: View {
    @StateObject private var qrManager = QRCodeManager.shared
    @StateObject private var contactRepository = ContactRepository.shared
    
    @State private var showingScannedCard = false
    @State private var showingError = false
    @State private var lastVerification: VerificationStatus = .unverified
    @State private var cameraPreviewLayer: AVCaptureVideoPreviewLayer?
    @State private var showingPermissionAlert = false
    @State private var permissionAlertMessage = ""
    
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        NavigationView {
            ZStack {
                // Camera preview
                CameraPreviewView(previewLayer: $cameraPreviewLayer)
                    .ignoresSafeArea()
                
                // Overlay UI
                VStack {
                    // Top bar
                    HStack {
                        Button("Cancel") {
                            qrManager.stopScanning()
                            dismiss()
                        }
                        .foregroundColor(.white)
                        .padding()
                        
                        Spacer()
                        
                        Text("Scan QR Code")
                            .font(.headline)
                            .foregroundColor(.white)
                        
                        Spacer()
                        
                        // Placeholder to balance layout
                        Color.clear.frame(width: 44, height: 44)
                            .padding()
                    }
                    .background(Color.black.opacity(0.7))
                    
                    Spacer()
                    
                    // Scanning frame
                    ScanningFrameView()
                    
                    Spacer()
                    
                    // Instructions
                    VStack(spacing: 8) {
                        Text("Position QR code within the frame")
                            .font(.subheadline)
                            .foregroundColor(.white)
                        
                        if qrManager.isScanning {
                            HStack {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    .scaleEffect(0.8)
                                
                                Text("Scanning...")
                                    .font(.caption)
                                    .foregroundColor(.white)
                            }
                        }
                    }
                    .padding()
                    .background(Color.black.opacity(0.7))
                    .cornerRadius(10)
                    .padding(.horizontal)
                    .padding(.bottom, 50)
                }
                .transaction { transaction in
                    transaction.animation = nil // Prevent animation propagation from scanning line
                }
            }
        }
        .navigationBarHidden(true)
        .onAppear {
            ensureCameraPermissionAndStart()
        }
        .onDisappear {
            qrManager.stopScanning()
            cameraPreviewLayer = nil
        }
        .onChange(of: qrManager.lastScannedCard) { _, scannedCard in
            if scannedCard != nil {
                lastVerification = qrManager.lastVerificationStatus ?? .unverified
                showingScannedCard = true
            }
        }
        .onChange(of: qrManager.scanError) { _, error in
            if error != nil {
                showingError = true
            }
        }
        .sheet(isPresented: $showingScannedCard) {
            if let scannedCard = qrManager.lastScannedCard {
                ScannedCardView(businessCard: scannedCard, verification: lastVerification) {
                    // Save to contacts
                    saveScannedCard(scannedCard)
                }
            }
        }
        .alert("Scan Error", isPresented: $showingError) {
            Button("Try Again") {
                qrManager.scanError = nil
                ensureCameraPermissionAndStart()
            }
            Button("Cancel") {
                dismiss()
            }
        } message: {
            Text(qrManager.scanError?.localizedDescription ?? "Unknown error occurred")
        }
        .alert("Camera Permission", isPresented: $showingPermissionAlert) {
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text(permissionAlertMessage)
        }
    }
    
    // MARK: - Private Methods
    
    private func startScanning() {
        let result = qrManager.startScanning()
        
        switch result {
        case .success(let previewLayer):
            self.cameraPreviewLayer = previewLayer
        case .failure(let error):
            qrManager.scanError = error
            showingError = true
        }
    }
    
    private func ensureCameraPermissionAndStart() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            startScanning()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    if granted {
                        startScanning()
                    } else {
                        permissionAlertMessage = "Camera access is required to scan QR codes. Please enable it in Settings."
                        showingPermissionAlert = true
                    }
                }
            }
        case .denied, .restricted:
            permissionAlertMessage = "Camera access is required to scan QR codes. Please enable it in Settings."
            showingPermissionAlert = true
        @unknown default:
            permissionAlertMessage = "Camera access is required to scan QR codes."
            showingPermissionAlert = true
        }
    }
    
    private func saveScannedCard(_ businessCard: BusinessCard) {
        let contact = Contact(
            id: UUID(),
            businessCard: businessCard,
            receivedAt: Date(),
            source: .qrCode,
            tags: [],
            notes: nil,
            verificationStatus: lastVerification,
            sealedRoute: qrManager.lastSealedRoute
        )
        
        let result = contactRepository.addContact(contact)
        
        switch result {
        case .success:
            showingScannedCard = false
            dismiss()
        case .failure(let error):
            qrManager.scanError = error
            showingError = true
        }
    }
}

// MARK: - Camera Preview View

struct CameraPreviewView: UIViewRepresentable {
    @Binding var previewLayer: AVCaptureVideoPreviewLayer?
    
    func makeUIView(context: Context) -> PreviewContainerView {
        let view = PreviewContainerView()
        view.backgroundColor = .black
        return view
    }
    
    func updateUIView(_ uiView: PreviewContainerView, context: Context) {
        if let previewLayer = previewLayer {
            uiView.setPreviewLayer(previewLayer)
        }
    }
    
    // Internal UIView subclass to handle layout updates
    class PreviewContainerView: UIView {
        var previewLayer: AVCaptureVideoPreviewLayer?
        
        func setPreviewLayer(_ layer: AVCaptureVideoPreviewLayer) {
            // Remove old layer if exists
            self.previewLayer?.removeFromSuperlayer()
            
            // Set new layer
            self.previewLayer = layer
            layer.videoGravity = .resizeAspectFill
            self.layer.addSublayer(layer)
            
            // Initial layout
            layer.frame = bounds
        }
        
        override func layoutSubviews() {
            super.layoutSubviews()
            // Ensure preview layer matches view bounds on layout changes
            previewLayer?.frame = bounds
        }
    }
}

// MARK: - Scanning Frame View

struct ScanningFrameView: View {
    var body: some View {
        ZStack {
            // Scanning frame
            RoundedRectangle(cornerRadius: 20)
                .stroke(Color.white, lineWidth: 3)
                .frame(width: 250, height: 250)
            
            // Corner indicators
            VStack {
                HStack {
                    CornerIndicator(corners: [.topLeft])
                    Spacer()
                    CornerIndicator(corners: [.topRight])
                }
                Spacer()
                HStack {
                    CornerIndicator(corners: [.bottomLeft])
                    Spacer()
                    CornerIndicator(corners: [.bottomRight])
                }
            }
            .frame(width: 250, height: 250)
            
            // Scanning line animation - isolated to prevent affecting parent views
            ScanningLineView()
        }
        .frame(width: 250, height: 250)
        .transaction { transaction in
            transaction.animation = nil // Prevent animation propagation to parent
        }
    }
}

// MARK: - Scanning Line View

struct ScanningLineView: View {
    @State private var animationOffset: CGFloat = -125
    
    var body: some View {
        Rectangle()
            .fill(
                LinearGradient(
                    colors: [.clear, .green, .clear],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .frame(width: 250, height: 2)
            .offset(y: animationOffset)
            .onAppear {
                withAnimation(
                    .easeInOut(duration: 2)
                    .repeatForever(autoreverses: true)
                ) {
                    animationOffset = 125
                }
            }
    }
}

// MARK: - Corner Indicator

struct CornerIndicator: View {
    let corners: UIRectCorner
    
    var body: some View {
        RoundedCorner(radius: 8, corners: corners)
            .fill(Color.green)
            .frame(width: 30, height: 30)
    }
}

struct RoundedCorner: Shape {
    var radius: CGFloat = .infinity
    var corners: UIRectCorner = .allCorners
    
    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: corners,
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}

// MARK: - Scanned Card View

struct ScannedCardView: View {
    let businessCard: BusinessCard
    let verification: VerificationStatus
    let onSave: () -> Void
    
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Header
                    VStack(alignment: .center, spacing: 12) {
                        // Profile image placeholder
                        if let imageData = businessCard.profileImage,
                           let uiImage = UIImage(data: imageData) {
                            Image(uiImage: uiImage)
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(width: 100, height: 100)
                                .clipShape(Circle())
                        } else {
                            Circle()
                                .fill(Color.gray.opacity(0.3))
                                .frame(width: 100, height: 100)
                                .overlay(
                                    Image(systemName: "person.fill")
                                        .font(.system(size: 40))
                                        .foregroundColor(.gray)
                                )
                        }
                        HStack(spacing: 8) {
                            Image(systemName: verification.systemImageName)
                                .foregroundColor(
                                    verification == .verified ? .green : (verification == .failed ? .red : .orange)
                                )
                            Text(verification.displayName)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        
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
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
                    
                    // Contact information
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Contact Information")
                            .font(.headline)
                        
                        if let email = businessCard.email {
                            ContactInfoRow(
                                icon: "envelope.fill",
                                label: "Email",
                                value: email
                            )
                        }
                        
                        if let phone = businessCard.phone {
                            ContactInfoRow(
                                icon: "phone.fill",
                                label: "Phone",
                                value: phone
                            )
                        }
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
                    
                    // Skills
                    if !businessCard.skills.isEmpty {
                        VStack(alignment: .leading, spacing: 16) {
                            Text("Skills")
                                .font(.headline)
                            
                            LazyVGrid(columns: [
                                GridItem(.flexible()),
                                GridItem(.flexible())
                            ], spacing: 8) {
                                ForEach(businessCard.skills) { skill in
                                    SkillChip(skill: skill)
                                }
                            }
                        }
                        .padding()
                        .background(Color(.systemGray6))
                        .cornerRadius(12)
                    }
                    
                    Spacer()
                }
                .padding()
            }
            .navigationTitle("Scanned Business Card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        onSave()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
    }
}


// MARK: - Supporting Views
// Shared components are now in SharedComponents.swift

#Preview {
    QRScannerView()
}