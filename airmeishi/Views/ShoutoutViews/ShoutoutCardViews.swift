//
//  ShoutoutCardViews.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import SwiftUI

// MARK: - Lightening Card View

struct LighteningCardView: View {
  let dataPoint: ChartDataPoint
  let isLighteningAnimating: Bool
  let onTap: () -> Void

  @State private var cardOffset: CGFloat = 0
  @State private var isHovering = false

  var body: some View {
    Button(action: onTap) {
      VStack(spacing: 12) {
        // Card header with lightning effect
        HStack {
          // Profile image with lightning border
          AsyncImage(url: dataPoint.user.profileImageURL) { image in
            image
              .resizable()
              .aspectRatio(contentMode: .fill)
          } placeholder: {
            Circle()
              .fill(
                LinearGradient(
                  colors: [dataPoint.color, dataPoint.color.opacity(0.6)],
                  startPoint: .topLeading,
                  endPoint: .bottomTrailing
                )
              )
              .overlay {
                Text(dataPoint.user.initials)
                  .font(.headline)
                  .fontWeight(.bold)
                  .foregroundColor(.white)
              }
          }
          .frame(width: 50, height: 50)
          .clipShape(Circle())
          .overlay(
            Circle()
              .stroke(
                isLighteningAnimating ? Color.pink : dataPoint.color,
                lineWidth: isLighteningAnimating ? 3 : 2
              )
              .scaleEffect(isLighteningAnimating ? 1.1 : 1.0)
              .animation(
                .easeInOut(duration: 0.5).repeatForever(autoreverses: true),
                value: isLighteningAnimating
              )
          )
          .shadow(
            color: isLighteningAnimating ? .pink.opacity(0.6) : dataPoint.color.opacity(0.5),
            radius: isLighteningAnimating ? 8 : 4,
            x: 0,
            y: 2
          )

          Spacer()

          // Sakura indicator
          SakuraIconView(size: 16, color: isLighteningAnimating ? .pink : .gray, isAnimating: isLighteningAnimating)
        }

        // User info with fixed spacing
        VStack(alignment: .leading, spacing: 4) {
          Text(dataPoint.user.name)
            .font(.headline)
            .fontWeight(.semibold)
            .foregroundColor(.white)
            .lineLimit(1)

          // Always reserve space for company, even if empty
          Text(dataPoint.user.company.isEmpty ? " " : dataPoint.user.company)
            .font(.caption)
            .foregroundColor(dataPoint.user.company.isEmpty ? .clear : .gray)
            .lineLimit(1)
            .frame(height: 14)

          // Always reserve space for title, even if empty
          Text(dataPoint.user.title.isEmpty ? " " : dataPoint.user.title)
            .font(.caption2)
            .foregroundColor(dataPoint.user.title.isEmpty ? .clear : .gray.opacity(0.8))
            .lineLimit(1)
            .frame(height: 12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)

        Spacer(minLength: 0)

        // Verification status with lightning effect
        HStack {
          Image(systemName: dataPoint.user.verificationStatus.systemImageName)
            .foregroundColor(verificationColor)
            .font(.caption)

          Text(dataPoint.user.verificationStatus.displayName)
            .font(.caption2)
            .foregroundColor(.gray)

          Spacer()

          // Score indicator
          HStack(spacing: 2) {
            ForEach(0..<3) { index in
              Circle()
                .fill(index < Int(dataPoint.user.eventScore * 3) ? Color.pink : Color.gray.opacity(0.3))
                .frame(width: 4, height: 4)
            }
          }
        }
      }
      .padding(16)
      .frame(height: 180)
      .frame(maxWidth: .infinity)
      .background(
        RoundedRectangle(cornerRadius: 16)
          .fill(Color.white.opacity(0.05))
          .overlay(
            RoundedRectangle(cornerRadius: 16)
              .stroke(
                isLighteningAnimating ? Color.yellow.opacity(0.3) : Color.white.opacity(0.1),
                lineWidth: 1
              )
          )
      )
      .scaleEffect(isHovering ? 1.05 : 1.0)
      .offset(y: cardOffset)
      .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovering)
      .animation(.spring(response: 0.3, dampingFraction: 0.7), value: cardOffset)
    }
    .buttonStyle(PlainButtonStyle())
    .onHover { hovering in
      isHovering = hovering
    }
    .onTapGesture {
      withAnimation(.spring(response: 0.2, dampingFraction: 0.6)) {
        cardOffset = -5
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
          cardOffset = 0
        }
      }
      onTap()
    }
  }

  private var verificationColor: Color {
    switch dataPoint.user.verificationStatus {
    case .verified: return .green
    case .pending: return .orange
    case .unverified: return .blue
    case .failed: return .red
    }
  }
}

// MARK: - Contact Row View

struct ContactRowView: View {
  let dataPoint: ChartDataPoint
  let isLighteningAnimating: Bool
  let onTap: () -> Void

  @State private var isHovering = false

  var body: some View {
    Button(action: onTap) {
      HStack(spacing: 16) {
        // Profile image with lightning border
        AsyncImage(url: dataPoint.user.profileImageURL) { image in
          image
            .resizable()
            .aspectRatio(contentMode: .fill)
        } placeholder: {
          Circle()
            .fill(
              LinearGradient(
                colors: [dataPoint.color, dataPoint.color.opacity(0.6)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
              )
            )
            .overlay {
              Text(dataPoint.user.initials)
                .font(.headline)
                .fontWeight(.bold)
                .foregroundColor(.white)
            }
        }
        .frame(width: 60, height: 60)
        .clipShape(Circle())
        .overlay(
          Circle()
            .stroke(
              isLighteningAnimating ? Color.pink : dataPoint.color,
              lineWidth: isLighteningAnimating ? 3 : 2
            )
            .scaleEffect(isLighteningAnimating ? 1.1 : 1.0)
            .animation(
              .easeInOut(duration: 0.5).repeatForever(autoreverses: true),
              value: isLighteningAnimating
            )
        )
        .shadow(
          color: isLighteningAnimating ? .pink.opacity(0.6) : dataPoint.color.opacity(0.5),
          radius: isLighteningAnimating ? 8 : 4,
          x: 0,
          y: 2
        )

        // User info
        VStack(alignment: .leading, spacing: 4) {
          Text(dataPoint.user.name)
            .font(.headline)
            .fontWeight(.semibold)
            .foregroundColor(.white)
            .lineLimit(1)

          HStack(spacing: 8) {
            if !dataPoint.user.company.isEmpty {
              Text(dataPoint.user.company)
                .font(.subheadline)
                .foregroundColor(.gray)
                .lineLimit(1)
            }

            if !dataPoint.user.title.isEmpty {
              Text("•")
                .font(.subheadline)
                .foregroundColor(.gray.opacity(0.5))

              Text(dataPoint.user.title)
                .font(.subheadline)
                .foregroundColor(.gray)
                .lineLimit(1)
            }
          }

          // Verification status and score
          HStack(spacing: 8) {
            Image(systemName: dataPoint.user.verificationStatus.systemImageName)
              .foregroundColor(verificationColor)
              .font(.caption)

            Text(dataPoint.user.verificationStatus.displayName)
              .font(.caption2)
              .foregroundColor(.gray)

            // Score indicator
            HStack(spacing: 2) {
              ForEach(0..<3) { index in
                Circle()
                  .fill(index < Int(dataPoint.user.eventScore * 3) ? Color.pink : Color.gray.opacity(0.3))
                  .frame(width: 4, height: 4)
              }
            }
          }
        }

        Spacer()

        // Sakura indicator
        SakuraIconView(size: 24, color: isLighteningAnimating ? .pink : .gray, isAnimating: isLighteningAnimating)
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .background(
        RoundedRectangle(cornerRadius: 12)
          .fill(Color.white.opacity(0.05))
          .overlay(
            RoundedRectangle(cornerRadius: 12)
              .stroke(
                isLighteningAnimating ? Color.yellow.opacity(0.3) : Color.white.opacity(0.1),
                lineWidth: 1
              )
          )
      )
      .scaleEffect(isHovering ? 1.02 : 1.0)
      .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovering)
    }
    .buttonStyle(PlainButtonStyle())
    .onHover { hovering in
      isHovering = hovering
    }
  }

  private var verificationColor: Color {
    switch dataPoint.user.verificationStatus {
    case .verified: return .green
    case .pending: return .orange
    case .unverified: return .blue
    case .failed: return .red
    }
  }
}

// MARK: - Shoutout Info Row

struct ShoutoutInfoRow: View {
  let icon: String
  let title: String
  let value: String

  var body: some View {
    HStack {
      Image(systemName: icon)
        .foregroundColor(.white)
        .frame(width: 20)

      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.subheadline)
          .foregroundColor(.white)

        Text(value)
          .font(.caption)
          .foregroundColor(.gray)
      }

      Spacer()
    }
  }
}

// MARK: - Date Formatter Extension

extension DateFormatter {
  static let relativeDate: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    formatter.doesRelativeDateFormatting = true
    return formatter
  }()
}

// MARK: - Activity View Controller

struct ActivityViewController: UIViewControllerRepresentable {
  var activityItems: [Any]
  var applicationActivities: [UIActivity]?

  func makeUIViewController(
    context: UIViewControllerRepresentableContext<ActivityViewController>
  ) -> UIActivityViewController {
    UIActivityViewController(
      activityItems: activityItems,
      applicationActivities: applicationActivities
    )
  }

  func updateUIViewController(
    _ uiViewController: UIActivityViewController,
    context: UIViewControllerRepresentableContext<ActivityViewController>
  ) {}
}
