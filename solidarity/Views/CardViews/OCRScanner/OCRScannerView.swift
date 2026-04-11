//
//  OCRScannerView.swift
//  solidarity
//
//  Apple Vision OCR scanner for extracting business card information from camera and images
//

import AVFoundation
import PhotosUI
import SwiftUI
import Vision
import VisionKit

struct OCRScannerView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @StateObject var ocrManager = OCRManager()

    @State var showingLanguageSelection = true
    @State var selectedLanguage: ScanLanguage = .english
    @State var showingCamera = false
    @State var showingImagePicker = false
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State var capturedImage: UIImage?
    @State private var extractedCard: BusinessCard?
    @State var isProcessing = false
    @State private var showingResults = false
    @State var showingAlert = false
    @State var alertMessage = ""
    @State var showSettingsButton = false

    let onCardExtracted: (BusinessCard) -> Void

    private var isIPad: Bool {
        horizontalSizeClass == .regular
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    if showingLanguageSelection {
                        languageSelectionContent
                    } else if let image = capturedImage {
                        imagePreviewSection(image)
                    } else {
                        scanningOptionsContent
                    }

                    if isProcessing {
                        processingSection
                    } else if let card = extractedCard {
                        extractedDataContent(card)
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
                    Button("OK") {}
                }
            } message: {
                Text(alertMessage)
            }
        }
        .navigationViewStyle(.stack)
    }

    // MARK: - View Sections

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

    // MARK: - Methods

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
                    let format = String(localized: "Failed to load image: %@")
                    alertMessage = String(format: format, error.localizedDescription)
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
                    let format = String(localized: "Failed to extract information: %@")
                    alertMessage = String(format: format, error.localizedDescription)
                    showingAlert = true
                }
            }
        }
    }
}

#Preview {
    OCRScannerView { _ in }
}
