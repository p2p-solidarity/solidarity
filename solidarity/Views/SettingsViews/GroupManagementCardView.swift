//
//  GroupManagementCardView.swift
//  solidarity
//
//  Created by Solidarity Team.
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
              colors: [.clear, Color.Theme.pageBg.opacity(0.8)],
              startPoint: .top,
              endPoint: .bottom
            )
          )
      } else {
        // Fallback Gradient
        LinearGradient(
          colors: [Color.Theme.primaryBlue.opacity(0.3), Color.Theme.dustyMauve.opacity(0.3)],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
        .frame(height: 200)
        .overlay(
          LinearGradient(
            colors: [.clear, Color.Theme.pageBg.opacity(0.6)],
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
              .font(.system(size: 12, design: .monospaced))
              .foregroundColor(Color.Theme.dustyMauve)
              .padding(6)
              .background(Color.Theme.pageBg.opacity(0.5))
              .clipShape(Circle())
          }

          Spacer()

          // Delete Button (Top Right)
          Button(action: onDelete) {
            Image(systemName: "trash")
              .foregroundColor(Color.Theme.textPrimary)
              .padding(8)
              .background(Color.Theme.destructive.opacity(0.7))
              .clipShape(Circle())
          }
        }

        Spacer()

        Text(group.name)
          .font(.system(size: 28, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textPrimary)
          .lineLimit(1)

        if !group.description.isEmpty {
          Text(group.description)
            .font(.system(size: 14))
            .foregroundColor(Color.Theme.textSecondary)
            .lineLimit(2)
        }

        HStack(spacing: 12) {
          HStack(spacing: 4) {
            Image(systemName: "person.2.fill")
            Text("\(group.memberCount)")
          }
          .font(.system(size: 12, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)

          if !group.isSynced {
            HStack(spacing: 4) {
              Image(systemName: "arrow.triangle.2.circlepath")
              Text("Unsynced")
            }
            .font(.system(size: 12, design: .monospaced))
            .foregroundColor(Color.Theme.accentRose)
          }
        }
      }
      .padding(16)
    }
    .frame(height: 200)
    .background(Color.Theme.cardBg)
    .cornerRadius(20)
    .shadow(color: Color.Theme.pageBg.opacity(0.3), radius: 10, x: 0, y: 5)
    .overlay(
      RoundedRectangle(cornerRadius: 20)
        .stroke(Color.Theme.divider, lineWidth: 1)
    )
  }
}
