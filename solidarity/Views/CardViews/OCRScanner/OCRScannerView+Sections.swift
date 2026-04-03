//
//  OCRScannerView+Sections.swift
//  solidarity
//

import AVFoundation
import SwiftUI

extension OCRScannerView {

    var languageSelectionContent: some View {
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

    var scanningOptionsContent: some View {
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

    func extractedDataContent(_ card: BusinessCard) -> some View {
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
                    ExtractedFieldView(label: String(localized: "Name"), value: card.name, confidence: ocrManager.lastConfidenceScores["name"])
                }

                if let title = card.title, !title.isEmpty {
                    ExtractedFieldView(label: String(localized: "Title"), value: title, confidence: ocrManager.lastConfidenceScores["title"])
                }

                if let company = card.company, !company.isEmpty {
                    ExtractedFieldView(label: String(localized: "Company"), value: company, confidence: ocrManager.lastConfidenceScores["company"])
                }

                if let email = card.email, !email.isEmpty {
                    ExtractedFieldView(label: String(localized: "Email"), value: email, confidence: ocrManager.lastConfidenceScores["email"])
                }

                if let phone = card.phone, !phone.isEmpty {
                    ExtractedFieldView(label: String(localized: "Phone"), value: phone, confidence: ocrManager.lastConfidenceScores["phone"])
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

    func checkCameraPermission() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            showingCamera = true
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    if granted {
                        showingCamera = true
                    } else {
                        alertMessage = String(localized: "Camera access is required to scan business cards. Please enable it in Settings.")
                        showSettingsButton = true
                        showingAlert = true
                    }
                }
            }
        case .denied, .restricted:
            alertMessage = String(localized: "Camera access is required. Please enable it in Settings.")
            showSettingsButton = true
            showingAlert = true
        @unknown default:
            alertMessage = String(localized: "Camera access is required to scan business cards")
            showingAlert = true
        }
    }
}
