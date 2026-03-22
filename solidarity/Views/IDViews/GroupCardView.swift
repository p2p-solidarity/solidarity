//
//  GroupCardView.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import SwiftUI

struct GroupCardView: View {
  let membership: GroupMembership
  let isSelected: Bool
  let onTap: () -> Void

  var body: some View {
    Button(action: onTap) {
      VStack(alignment: .leading, spacing: 12) {
        // Header
        HStack {
          Image(systemName: "person.3.fill")
            .font(.caption)
            .padding(6)
            .background(Color.white.opacity(0.2))
            .clipShape(Circle())

          Spacer()

          statusBadge
        }

        Spacer()

        // Content
        VStack(alignment: .leading, spacing: 4) {
          Text(membership.name)
            .font(.headline)
            .foregroundColor(.white)
            .lineLimit(2)
            .multilineTextAlignment(.leading)

          if let index = membership.memberIndex {
            Text("Member #\(index + 1)")
              .font(.caption2)
              .foregroundColor(.white.opacity(0.8))
          } else {
            Text("Not a member")
              .font(.caption2)
              .foregroundColor(.white.opacity(0.6))
          }
        }
      }
      .padding(16)
      .frame(width: 160, height: 200)
      .background(cardBackground)
      .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 20, style: .continuous)
          .stroke(isSelected ? Color.white : Color.clear, lineWidth: 3)
      )
      .shadow(color: Color.black.opacity(0.15), radius: 8, x: 0, y: 4)
      .scaleEffect(isSelected ? 1.05 : 1.0)
      .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isSelected)
    }
    .buttonStyle(.plain)
  }

  private var statusBadge: some View {
    Group {
      switch membership.status {
      case .active:
        Image(systemName: "checkmark.circle.fill")
          .foregroundColor(.green)
      case .outdated:
        Image(systemName: "exclamationmark.triangle.fill")
          .foregroundColor(.yellow)
      case .pending:
        ProgressView()
          .scaleEffect(0.5)
      case .notMember:
        Image(systemName: "circle")
          .foregroundColor(.white.opacity(0.5))
      }
    }
    .padding(4)
    .background(Color.black.opacity(0.2))
    .clipShape(Circle())
  }

  private var cardBackground: some View {
    ZStack {
      // Base Gradient
      LinearGradient(
        colors: gradientColors,
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )

      // Abstract Pattern (Circles)
      GeometryReader { geo in
        Circle()
          .fill(Color.white.opacity(0.1))
          .frame(width: geo.size.width * 0.8)
          .offset(x: -geo.size.width * 0.2, y: -geo.size.height * 0.2)

        Circle()
          .fill(Color.white.opacity(0.05))
          .frame(width: geo.size.width * 0.6)
          .offset(x: geo.size.width * 0.5, y: geo.size.height * 0.6)
      }
    }
  }

  private var gradientColors: [Color] {
    switch membership.status {
    case .active:
      return [Color.blue, Color.purple]
    case .outdated:
      return [Color.orange, Color.red]
    case .pending:
      return [Color.gray, Color.gray.opacity(0.7)]
    case .notMember:
      return [Color.gray.opacity(0.8), Color.gray.opacity(0.6)]
    }
  }
}
