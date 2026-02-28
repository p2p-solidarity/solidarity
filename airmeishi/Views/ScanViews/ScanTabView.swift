//
//  ScanTabView.swift
//  airmeishi
//
//  Tab root - persistent QR scanner tab (no Cancel button, lifecycle-aware)
//

import AVFoundation
import SwiftUI

struct ScanTabView: View {
  @StateObject private var qrManager = QRCodeManager.shared
  @StateObject private var contactRepository = ContactRepository.shared
  @Environment(\.colorScheme) private var colorScheme

  @State private var showingScannedCard = false
  @State private var showingError = false
  @State private var lastVerification: VerificationStatus = .unverified
  @State private var cameraPreviewLayer: AVCaptureVideoPreviewLayer?
  @State private var showingPermissionAlert = false
  @State private var permissionAlertMessage = ""

  var body: some View {
    NavigationStack {
      ZStack {
        // Background base
        Color.Theme.cardBg
          .ignoresSafeArea()

        // Camera preview
        CameraPreviewView(previewLayer: $cameraPreviewLayer)
          .ignoresSafeArea()

        // Overlay UI
        VStack {
          Spacer()

          ScanningFrameView()

          Spacer()

          // Instructions
          VStack(spacing: 8) {
            Text("將 QR Code 對準框內")
              .font(.system(size: 15, weight: .medium))
              .foregroundColor(Color.Theme.textPrimary)

            if qrManager.isScanning {
              HStack(spacing: 6) {
                ProgressView()
                  .progressViewStyle(CircularProgressViewStyle(tint: Color.Theme.textTertiary))
                  .scaleEffect(0.8)

                Text("掃描中...")
                  .font(.system(size: 13))
                  .foregroundColor(Color.Theme.textSecondary)
              }
            }
          }
          .padding(.horizontal, 20)
          .padding(.vertical, 14)
          .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
              .fill(Color.Theme.cardBg.opacity(0.95))
              .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                  .stroke(Color.Theme.divider, lineWidth: 0.5)
              )
          )
          .padding(.horizontal, 20)
          .padding(.bottom, 100)
        }
        .transaction { transaction in
          transaction.animation = nil
        }
      }
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .principal) {
          Text("scan")
            .font(.system(size: 18))
            .foregroundColor(Color.Theme.textPrimary)
        }
      }
    }
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
          saveScannedCard(scannedCard)
        }
      }
    }
    .alert("掃描錯誤", isPresented: $showingError) {
      Button("重試") {
        qrManager.scanError = nil
        ensureCameraPermissionAndStart()
      }
      Button("取消", role: .cancel) {}
    } message: {
      Text(qrManager.scanError?.localizedDescription ?? "Unknown error occurred")
    }
    .alert("相機權限", isPresented: $showingPermissionAlert) {
      Button("前往設定") {
        if let url = URL(string: UIApplication.openSettingsURLString) {
          UIApplication.shared.open(url)
        }
      }
      Button("取消", role: .cancel) {}
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
            permissionAlertMessage = "需要相機權限才能掃描 QR Code，請前往設定開啟。"
            showingPermissionAlert = true
          }
        }
      }
    case .denied, .restricted:
      permissionAlertMessage = "需要相機權限才能掃描 QR Code，請前往設定開啟。"
      showingPermissionAlert = true
    @unknown default:
      permissionAlertMessage = "需要相機權限才能掃描 QR Code。"
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
      ToastManager.shared.show(
        title: "已儲存",
        message: "聯絡人已新增到通訊錄。",
        type: .success
      )
    case .failure(let error):
      qrManager.scanError = error
      showingError = true
    }
  }
}
