//
//  GroupManagementCardView.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import SwiftUI

struct GroupManagementCardView: View {
  let group: GroupModel
  let onDelete: () -> Void

  var body: some View {
    ZStack(alignment: .bottomLeading) {
      // Background / Cover Image
      if let imageData = group.coverImage, let uiImage = UIImage(data: imageData) {
        Image(uiImage: uiImage)
          .resizable()
          .aspectRatio(contentMode: .fill)
          .frame(height: 200)
          .clipped()
          .overlay(
            LinearGradient(
              colors: [.clear, .black.opacity(0.8)],
              startPoint: .top,
              endPoint: .bottom
            )
          )
      } else {
        // Fallback Gradient
        LinearGradient(
          colors: [Color.blue.opacity(0.3), Color.purple.opacity(0.3)],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
        .frame(height: 200)
        .overlay(
          LinearGradient(
            colors: [.clear, .black.opacity(0.6)],
            startPoint: .top,
            endPoint: .bottom
          )
        )
      }

      // Content
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          if group.isPrivate {
            Image(systemName: "lock.fill")
              .font(.caption)
              .foregroundColor(.yellow)
              .padding(6)
              .background(Color.black.opacity(0.5))
              .clipShape(Circle())
          }

          Spacer()

          // Delete Button (Top Right)
          Button(action: onDelete) {
            Image(systemName: "trash")
              .foregroundColor(.white)
              .padding(8)
              .background(Color.red.opacity(0.7))
              .clipShape(Circle())
          }
        }

        Spacer()

        Text(group.name)
          .font(.title2)
          .fontWeight(.bold)
          .foregroundColor(.white)
          .lineLimit(1)

        if !group.description.isEmpty {
          Text(group.description)
            .font(.subheadline)
            .foregroundColor(.white.opacity(0.8))
            .lineLimit(2)
        }

        HStack(spacing: 12) {
          HStack(spacing: 4) {
            Image(systemName: "person.2.fill")
            Text("\(group.memberCount)")
          }
          .font(.caption)
          .foregroundColor(.white.opacity(0.7))

          if !group.isSynced {
            HStack(spacing: 4) {
              Image(systemName: "arrow.triangle.2.circlepath")
              Text("Unsynced")
            }
            .font(.caption)
            .foregroundColor(.orange)
          }
        }
      }
      .padding(16)
    }
    .frame(height: 200)
    .background(Color(red: 0.1, green: 0.1, blue: 0.15))
    .cornerRadius(20)
    .shadow(color: Color.black.opacity(0.3), radius: 10, x: 0, y: 5)
    .overlay(
      RoundedRectangle(cornerRadius: 20)
        .stroke(Color.white.opacity(0.1), lineWidth: 1)
    )
  }
}
