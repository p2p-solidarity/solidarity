//
//  ScanComponents.swift
//  solidarity
//
//  Shared camera/scan UI components used by ScanTabView and MRZCameraView
//

import AVFoundation
import SwiftUI
import UIKit

// MARK: - Camera Preview

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

  class PreviewContainerView: UIView {
    var previewLayer: AVCaptureVideoPreviewLayer?

    func setPreviewLayer(_ layer: AVCaptureVideoPreviewLayer) {
      self.previewLayer?.removeFromSuperlayer()
      self.previewLayer = layer
      layer.videoGravity = .resizeAspectFill
      self.layer.addSublayer(layer)
      layer.frame = bounds
    }

    override func layoutSubviews() {
      super.layoutSubviews()
      previewLayer?.frame = bounds
    }
  }
}

// MARK: - Scanning Frame

struct ScanningFrameView: View {
  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: 20)
        .stroke(Color.white, lineWidth: 3)
        .frame(width: 250, height: 250)

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

      ScanningLineView()
    }
    .frame(width: 250, height: 250)
    .transaction { transaction in
      transaction.animation = nil
    }
  }
}

// MARK: - Scanning Line

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
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          VStack(alignment: .center, spacing: 12) {
            if let imageData = businessCard.profileImage,
              let uiImage = UIImage(data: imageData)
            {
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
          .background(Color.Theme.cardBg)
          .cornerRadius(12)

          VStack(alignment: .leading, spacing: 16) {
            Text("Contact Information")
              .font(.headline)

            if let email = businessCard.email {
              ContactInfoRow(
                icon: "envelope.fill",
                label: String(localized: "Email"),
                value: email
              )
            }

            if let phone = businessCard.phone {
              ContactInfoRow(
                icon: "phone.fill",
                label: String(localized: "Phone"),
                value: phone
              )
            }
          }
          .padding()
          .background(Color.Theme.cardBg)
          .cornerRadius(12)

          if !businessCard.skills.isEmpty {
            VStack(alignment: .leading, spacing: 16) {
              Text("Skills")
                .font(.headline)

              LazyVGrid(
                columns: [
                  GridItem(.flexible()),
                  GridItem(.flexible()),
                ],
                spacing: 8
              ) {
                ForEach(businessCard.skills) { skill in
                  SkillChip(skill: skill)
                }
              }
            }
            .padding()
            .background(Color.Theme.cardBg)
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
