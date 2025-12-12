//
//  OCRScannerView.swift
//  airmeishi
//
//  Apple Vision OCR scanner for extracting business card information from camera and images
//

import SwiftUI
import Vision
import VisionKit
import PhotosUI
import AVFoundation

struct OCRScannerView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @StateObject private var ocrManager = OCRManager()

    @State private var showingLanguageSelection = true
    @State private var selectedLanguage: ScanLanguage = .english
    @State private var showingCamera = false
    @State private var showingImagePicker = false
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var capturedImage: UIImage?
    @State private var extractedCard: BusinessCard?
    @State private var isProcessing = false
    @State private var showingResults = false
    @State private var showingAlert = false
    @State private var alertMessage = ""
    @State private var showSettingsButton = false

    let onCardExtracted: (BusinessCard) -> Void

    private var isIPad: Bool {
        horizontalSizeClass == .regular
    }
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    if showingLanguageSelection {
                        languageSelectionSection
                    } else if let image = capturedImage {
                        imagePreviewSection(image)
                    } else {
                        scanningOptionsSection
                    }

                    if isProcessing {
                        processingSection
                    } else if let card = extractedCard {
                        extractedDataSection(card)
                    }

                    Spacer(minLength: 40)
                }
                .padding(isIPad ? 32 : 20)
                .frame(maxWidth: isIPad ? 600 : .infinity)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("Scan Business Card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                if extractedCard != nil {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button("Use Data") {
                            if let card = extractedCard {
                                onCardExtracted(card)
                            }
                            dismiss()
                        }
                    }
                }
            }
            .sheet(isPresented: $showingCamera) {
                CameraView { image in
                    capturedImage = image
                    processImage(image)
                }
            }
            .photosPicker(isPresented: $showingImagePicker, selection: $selectedPhotoItem, matching: .images)
            .onChange(of: selectedPhotoItem) { _, newItem in
                loadSelectedImage(newItem)
            }
            .alert("Error", isPresented: $showingAlert) {
                if showSettingsButton {
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    }
                    Button("OK", role: .cancel) { showSettingsButton = false }
                } else {
                    Button("OK") { }
                }
            } message: {
                Text(alertMessage)
            }
        }
        .navigationViewStyle(.stack)
    }
    
    // MARK: - View Sections
    
    private var languageSelectionSection: some View {
        VStack(spacing: 28) {
            Image(systemName: "globe")
                .font(.system(size: 64))
                .foregroundColor(.blue)
                .padding(.top, 20)

            VStack(spacing: 8) {
                Text("Select Language")
                    .font(.title2)
                    .fontWeight(.semibold)

                Text("Choose the language of the business card you want to scan")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }

            VStack(spacing: 14) {
                ForEach(ScanLanguage.allCases) { language in
                    LanguageOptionView(
                        language: language,
                        isSelected: selectedLanguage == language
                    ) {
                        selectedLanguage = language
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 8)

            Button("Continue") {
                showingLanguageSelection = false
            }
            .font(.headline)
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(Color.black)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.horizontal, 24)
            .padding(.top, 24)
            .padding(.bottom, 20)
        }
    }
    
    private var scanningOptionsSection: some View {
        VStack(spacing: 24) {
            Image(systemName: "doc.text.viewfinder")
                .font(.system(size: 60))
                .foregroundColor(.blue)
            
            Text("Scan Business Card")
                .font(.title2)
                .fontWeight(.semibold)
            
            Text("Use your camera to scan a business card or select an image from your photos")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            
            VStack(spacing: 16) {
                Button(action: {
                    checkCameraPermission()
                }) {
                    HStack {
                        Image(systemName: "camera")
                        Text("Take Photo")
                    }
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(Color.black)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }

                Button(action: {
                    showingImagePicker = true
                }) {
                    HStack {
                        Image(systemName: "photo")
                        Text("Choose from Photos")
                    }
                    .font(.headline)
                    .foregroundColor(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(Color.black.opacity(0.2), lineWidth: 1)
                    )
                }
            }
        }
    }
    
    private func imagePreviewSection(_ image: UIImage) -> some View {
        VStack(spacing: 16) {
            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(maxHeight: 200)
                .cornerRadius(10)
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                )
            
            HStack(spacing: 16) {
                Button("Retake") {
                    capturedImage = nil
                    extractedCard = nil
                    checkCameraPermission()
                }
                .buttonStyle(.bordered)
                
                Button("Choose Different") {
                    capturedImage = nil
                    extractedCard = nil
                    showingImagePicker = true
                }
                .buttonStyle(.bordered)
            }
        }
    }
    
    private var processingSection: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.2)
            
            Text("Processing image...")
                .font(.body)
                .foregroundColor(.secondary)
            
            Text("Extracting text and identifying contact information")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .background(Color.gray.opacity(0.1))
        .cornerRadius(10)
    }
    
    private func extractedDataSection(_ card: BusinessCard) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
                Text("Extraction Complete")
                    .font(.headline)
                Spacer()
            }
            
            VStack(alignment: .leading, spacing: 8) {
                if !card.name.isEmpty {
                    ExtractedFieldView(label: "Name", value: card.name, confidence: ocrManager.lastConfidenceScores["name"])
                }
                
                if let title = card.title, !title.isEmpty {
                    ExtractedFieldView(label: "Title", value: title, confidence: ocrManager.lastConfidenceScores["title"])
                }
                
                if let company = card.company, !company.isEmpty {
                    ExtractedFieldView(label: "Company", value: company, confidence: ocrManager.lastConfidenceScores["company"])
                }
                
                if let email = card.email, !email.isEmpty {
                    ExtractedFieldView(label: "Email", value: email, confidence: ocrManager.lastConfidenceScores["email"])
                }
                
                if let phone = card.phone, !phone.isEmpty {
                    ExtractedFieldView(label: "Phone", value: phone, confidence: ocrManager.lastConfidenceScores["phone"])
                }
            }
            
            Text("Review the extracted information and tap 'Use Data' to apply it to your business card form.")
                .font(.caption)
                .foregroundColor(.secondary)
                .padding(.top, 8)
        }
        .padding()
        .background(Color.green.opacity(0.1))
        .cornerRadius(10)
    }
    
    // MARK: - Methods
    
    private func checkCameraPermission() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            showingCamera = true
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    if granted {
                        showingCamera = true
                    } else {
                        alertMessage = "Camera access is required to scan business cards. Please enable it in Settings."
                        showSettingsButton = true
                        showingAlert = true
                    }
                }
            }
        case .denied, .restricted:
            alertMessage = "Camera access is required. Please enable it in Settings."
            showSettingsButton = true
            showingAlert = true
        @unknown default:
            alertMessage = "Camera access is required to scan business cards"
            showingAlert = true
        }
    }
    
    private func loadSelectedImage(_ item: PhotosPickerItem?) {
        guard let item = item else { return }
        
        item.loadTransferable(type: Data.self) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let data):
                    if let data = data, let image = UIImage(data: data) {
                        capturedImage = image
                        processImage(image)
                    }
                case .failure(let error):
                    alertMessage = "Failed to load image: \(error.localizedDescription)"
                    showingAlert = true
                }
            }
        }
    }
    
    private func processImage(_ image: UIImage) {
        isProcessing = true
        extractedCard = nil
        
        ocrManager.extractBusinessCardInfo(from: image) { result in
            DispatchQueue.main.async {
                isProcessing = false
                
                switch result {
                case .success(let card):
                    extractedCard = card
                case .failure(let error):
                    alertMessage = "Failed to extract information: \(error.localizedDescription)"
                    showingAlert = true
                }
            }
        }
    }
}

// MARK: - Supporting Views

struct ExtractedFieldView: View {
    let label: String
    let value: String
    let confidence: Float?
    
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                Text(value)
                    .font(.body)
            }
            
            Spacer()
            
            if let confidence = confidence {
                ConfidenceBadge(confidence: confidence)
            }
        }
    }
}

struct ConfidenceBadge: View {
    let confidence: Float

    var body: some View {
        let percentage = Int(confidence * 100)
        let color: Color = {
            if confidence >= 0.8 { return .green } else if confidence >= 0.6 { return .orange } else { return .red }
        }()

        Text("\(percentage)%")
            .font(.caption)
            .fontWeight(.semibold)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.2))
            .foregroundColor(color)
            .cornerRadius(6)
    }
}

struct CameraView: UIViewControllerRepresentable {
    let onImageCaptured: (UIImage) -> Void
    
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        picker.allowsEditing = false
        picker.cameraCaptureMode = .photo
        picker.cameraDevice = .rear
        picker.cameraFlashMode = .auto
        return picker
    }
    
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    
    func makeCoordinator() -> Coordinator {
        Coordinator(onImageCaptured: onImageCaptured)
    }
    
    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onImageCaptured: (UIImage) -> Void
        
        init(onImageCaptured: @escaping (UIImage) -> Void) {
            self.onImageCaptured = onImageCaptured
        }
        
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage {
                onImageCaptured(image)
            }
            picker.dismiss(animated: true)
        }
        
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            picker.dismiss(animated: true)
        }
    }
}

#Preview {
    OCRScannerView { _ in }
}
