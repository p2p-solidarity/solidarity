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

  @State private var isHovering = false

  var body: some View {
    Button(action: onTap) {
      VStack(spacing: 8) {
        // Card header
        HStack {
          // Profile image
          AsyncImage(url: dataPoint.user.profileImageURL) { image in
            image
              .resizable()
              .aspectRatio(contentMode: .fill)
          } placeholder: {
            Circle()
              .fill(Color.Theme.darkUI)
              .overlay {
                Text(dataPoint.user.initials)
                  .font(.system(size: 12, weight: .bold))
                  .foregroundColor(.white)
              }
          }
          .frame(width: 32, height: 32)
          .clipShape(Circle())
          .overlay(
            Circle()
              .stroke(Color.Theme.darkUI, lineWidth: 0.5)
          )

          Spacer()

          // Date
          Text(DateFormatter.relativeDate.string(from: dataPoint.user.lastInteraction))
            .font(.system(size: 10))
            .foregroundColor(Color.Theme.textTertiary)
        }

        // User info
        VStack(alignment: .leading, spacing: 4) {
          Text(dataPoint.user.name)
            .font(.system(size: 16, weight: .medium))
            .foregroundColor(Color.Theme.textPrimary)
            .lineLimit(1)

          if !dataPoint.user.company.isEmpty || !dataPoint.user.title.isEmpty {
            Text([dataPoint.user.title, dataPoint.user.company].filter { !$0.isEmpty }.joined(separator: " · "))
              .font(.system(size: 14))
              .foregroundColor(Color.Theme.textSecondary)
              .lineLimit(1)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)

        Spacer(minLength: 0)

        // Verification status
        HStack {
          Image(systemName: dataPoint.user.verificationStatus.systemImageName)
            .foregroundColor(verificationColor)
            .font(.caption)

          Text(dataPoint.user.verificationStatus.displayName)
            .font(.system(size: 10))
            .foregroundColor(Color.Theme.textTertiary)

          Spacer()
        }
      }
      .padding(12)
      .frame(height: 180)
      .frame(maxWidth: .infinity)
      .background(
        RoundedRectangle(cornerRadius: 8)
          .fill(Color.Theme.cardBg)
          .overlay(
            RoundedRectangle(cornerRadius: 8)
              .stroke(Color.Theme.divider, lineWidth: 0.5)
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

// MARK: - Contact Row View

struct ContactRowView: View {
  let dataPoint: ChartDataPoint
  let isLighteningAnimating: Bool
  let onTap: () -> Void

  @State private var isHovering = false

  var body: some View {
    Button(action: onTap) {
      VStack(spacing: 0) {
        HStack(alignment: .top, spacing: 8) {
          // Avatar container (38w)
          AsyncImage(url: dataPoint.user.profileImageURL) { image in
            image
              .resizable()
              .aspectRatio(contentMode: .fill)
          } placeholder: {
            Circle()
              .fill(Color.Theme.darkUI)
              .overlay {
                Text(dataPoint.user.initials)
                  .font(.system(size: 12, weight: .bold))
                  .foregroundColor(.white)
              }
          }
          .frame(width: 32, height: 32)
          .clipShape(Circle())
          .overlay(
            Circle()
              .stroke(Color.Theme.darkUI, lineWidth: 0.5)
          )
          .frame(width: 38)

          // Info box
          VStack(spacing: 0) {
            // Row 1: info main
            HStack(alignment: .top) {
              VStack(alignment: .leading, spacing: 2) {
                Text(dataPoint.user.name)
                  .font(.system(size: 16, weight: .medium))
                  .foregroundColor(Color.Theme.textPrimary)
                  .lineLimit(1)

                if !dataPoint.user.company.isEmpty || !dataPoint.user.title.isEmpty {
                  Text([dataPoint.user.title, dataPoint.user.company].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.system(size: 14))
                    .foregroundColor(Color.Theme.textSecondary)
                    .lineLimit(1)
                }
              }

              Spacer()

              VStack(alignment: .trailing, spacing: 2) {
                Text(DateFormatter.relativeDate.string(from: dataPoint.user.lastInteraction))
                  .font(.system(size: 10))
                  .foregroundColor(Color.Theme.textTertiary)

                Image(systemName: dataPoint.user.verificationStatus.systemImageName)
                  .foregroundColor(verificationColor)
                  .font(.system(size: 10))
              }
            }

            // Divider
            Rectangle()
              .fill(Color.Theme.divider)
              .frame(height: 0.5)
              .padding(.vertical, 8)

            // Row 2: marks / notes
            HStack {
              if !dataPoint.user.company.isEmpty {
                Text(dataPoint.user.company)
                  .font(.system(size: 11))
                  .foregroundColor(Color.Theme.textTertiary)
                  .lineLimit(1)
              } else {
                Text(dataPoint.user.verificationStatus.displayName)
                  .font(.system(size: 11))
                  .foregroundColor(Color.Theme.textTertiary)
                  .lineLimit(1)
              }
              Spacer()
            }
          }
        }
        .padding(.vertical, 12)
      }
      .overlay(alignment: .top) {
        Rectangle()
          .fill(Color.Theme.divider)
          .frame(height: 0.5)
      }
      .scaleEffect(isHovering ? 1.01 : 1.0)
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
        .foregroundColor(Color.Theme.textPrimary)
        .frame(width: 20)

      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.subheadline)
          .foregroundColor(Color.Theme.textPrimary)

        Text(value)
          .font(.caption)
          .foregroundColor(Color.Theme.textSecondary)
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
