import AVFoundation
import SwiftUI

/// Camera view for scanning passport MRZ zone.
struct MRZCameraView: View {
  let onScanned: (PassportMRZDraft) -> Void

  @Environment(\.dismiss) private var dismiss
  @StateObject private var scanner = MRZScannerService()
  @State private var previewLayer: AVCaptureVideoPreviewLayer?
  @State private var confirmedDraft: PassportMRZDraft?

  var body: some View {
    NavigationStack {
      ZStack {
        Color.black.ignoresSafeArea()
        CameraPreviewView(previewLayer: $previewLayer).ignoresSafeArea()

        VStack {
          Spacer()
          mrzOverlay
          Spacer()

          if let draft = confirmedDraft {
            confirmationCard(draft)
          } else {
            instructionFooter
          }
        }
      }
      .navigationTitle("Scan Passport")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button("Cancel") {
            scanner.stopScanning()
            dismiss()
          }
          .foregroundColor(.white)
        }
      }
      .toolbarBackground(.hidden, for: .navigationBar)
    }
    .onAppear { startCamera() }
    .onDisappear { scanner.stopScanning() }
    .onChange(of: scanner.scannedDraft) { _, draft in
      if let draft {
        HapticFeedbackManager.shared.softImpact()
        confirmedDraft = draft
      }
    }
  }

  // MARK: - Subviews

  /// Rectangular overlay guiding user to align MRZ zone
  private var mrzOverlay: some View {
    RoundedRectangle(cornerRadius: 8)
      .stroke(confirmedDraft != nil ? Color.green : Color.white, lineWidth: 2)
      .frame(width: 320, height: 60)
      .overlay(
        Text("Align MRZ zone here")
          .font(.caption)
          .foregroundColor(.white.opacity(0.7))
          .opacity(confirmedDraft == nil ? 1 : 0)
      )
  }

  private var instructionFooter: some View {
    VStack(spacing: 8) {
      if scanner.isScanning {
        HStack(spacing: 6) {
          ProgressView().tint(.white).scaleEffect(0.7)
          Text("Looking for MRZ...")
            .font(.caption)
            .foregroundColor(.white)
        }
      }
      if let error = scanner.errorMessage {
        Text(error)
          .font(.caption)
          .foregroundColor(.red)
      }
    }
    .padding(.bottom, 60)
  }

  private func confirmationCard(_ draft: PassportMRZDraft) -> some View {
    VStack(spacing: 10) {
      Text("MRZ Detected")
        .font(.headline)
        .foregroundColor(Color.Theme.textPrimary)

      VStack(alignment: .leading, spacing: 6) {
        infoRow("Passport", draft.passportNumber)
        infoRow("Nationality", draft.nationalityCode)
        infoRow("Date of Birth", formatted(draft.dateOfBirth))
        infoRow("Expiry", formatted(draft.expiryDate))
      }

      HStack(spacing: 12) {
        Button("Rescan") {
          confirmedDraft = nil
          scanner.startScanning()
        }
        .buttonStyle(.bordered)

        Button("Use This") {
          onScanned(draft)
          dismiss()
        }
        .buttonStyle(ThemedPrimaryButtonStyle())
      }
      .padding(.top, 4)
    }
    .padding(16)
    .background(Color.Theme.cardBg)
    .cornerRadius(12)
    .padding(.horizontal, 16)
    .padding(.bottom, 40)
  }

  private func infoRow(_ label: String, _ value: String) -> some View {
    HStack {
      Text(label)
        .font(.caption.weight(.semibold))
        .foregroundColor(Color.Theme.textTertiary)
        .frame(width: 100, alignment: .leading)
      Text(value)
        .font(.caption.monospaced())
        .foregroundColor(Color.Theme.textPrimary)
    }
  }

  private func formatted(_ date: Date) -> String {
    let fmt = DateFormatter()
    fmt.dateStyle = .medium
    return fmt.string(from: date)
  }

  // MARK: - Camera

  private func startCamera() {
    guard let session = scanner.setupSession() else { return }
    let layer = AVCaptureVideoPreviewLayer(session: session)
    layer.videoGravity = .resizeAspectFill
    previewLayer = layer
    scanner.startScanning()
  }
}
