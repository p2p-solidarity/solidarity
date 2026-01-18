//
//  ShoutoutFiltersView.swift
//  airmeishi
//
//  Filter and search options for 3D shoutout chart
//

import SwiftUI

struct ShoutoutFiltersView: View {
  @StateObject private var chartService = ShoutoutChartService.shared
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationView {
      Form {
        // Search Section
        Section("Search") {
          HStack {
            Image(systemName: "magnifyingglass")
              .foregroundColor(.secondary)

            TextField("Search users...", text: $chartService.searchQuery)
              .onChange(of: chartService.searchQuery) { _, newValue in
                chartService.searchUsers(query: newValue)
              }
          }
        }

        // Event Type Filter
        Section("Event Activity Level") {
          HStack {
            Image(systemName: "clear")
              .foregroundColor(.secondary)
              .frame(width: 20)

            Text("All Activity Levels")

            Spacer()

            if chartService.selectedEventType == nil {
              Image(systemName: "checkmark")
                .foregroundColor(.accentColor)
            }
          }
          .contentShape(Rectangle())
          .onTapGesture {
            chartService.selectedEventType = nil
            chartService.applyFilters()
          }

          ForEach(EventType.allCases) { eventType in
            HStack {
              Circle()
                .fill(Color.white.opacity(0.4))
                .frame(width: 10, height: 10)
              Text(eventType.rawValue)
              Spacer()
              if chartService.selectedEventType == eventType {
                Image(systemName: "checkmark")
                  .foregroundColor(.accentColor)
              }
            }
            .contentShape(Rectangle())
            .onTapGesture {
              chartService.selectedEventType = eventType
              chartService.applyFilters()
            }
          }
        }

        // Character Type Filter
        Section("Character Type") {
          HStack {
            Image(systemName: "clear")
              .foregroundColor(.secondary)
              .frame(width: 20)

            Text("All Character Types")

            Spacer()

            if chartService.selectedCharacterType == nil {
              Image(systemName: "checkmark")
                .foregroundColor(.accentColor)
            }
          }
          .contentShape(Rectangle())
          .onTapGesture {
            chartService.selectedCharacterType = nil
            chartService.applyFilters()
          }

          ForEach(CharacterType.allCases) { characterType in
            HStack {
              Circle()
                .fill(Color.white.opacity(0.4))
                .frame(width: 10, height: 10)
              Text(characterType.rawValue)
              Spacer()
              if chartService.selectedCharacterType == characterType {
                Image(systemName: "checkmark")
                  .foregroundColor(.accentColor)
              }
            }
            .contentShape(Rectangle())
            .onTapGesture {
              chartService.selectedCharacterType = characterType
              chartService.applyFilters()
            }
          }
        }

        // Tags Filter
        Section("Tags") {
          if chartService.getAllTags().isEmpty {
            Text("No tags available")
              .foregroundColor(.secondary)
          } else {
            LazyVGrid(
              columns: [
                GridItem(.adaptive(minimum: 100))
              ],
              spacing: 8
            ) {
              ForEach(chartService.getAllTags(), id: \.self) { tag in
                TagFilterChip(
                  tag: tag,
                  isSelected: chartService.selectedTags.contains(tag)
                ) {
                  chartService.toggleTag(tag)
                }
              }
            }
          }
        }

        // Clear All Filters
        Section {
          Button("Clear All Filters") {
            chartService.clearFilters()
          }
          .foregroundColor(.red)
          .frame(maxWidth: .infinity, alignment: .center)
        }
      }
      .navigationTitle("Filters")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Done") {
            dismiss()
          }
        }
      }
    }
  }
}

// MARK: - Tag Filter Chip

struct TagFilterChip: View {
  let tag: String
  let isSelected: Bool
  let onToggle: () -> Void

  var body: some View {
    Button(action: onToggle) {
      Text("#\(tag)")
        .font(.caption)
        .fontWeight(.medium)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
          isSelected ? Color.blue : Color.blue.opacity(0.1)
        )
        .foregroundColor(
          isSelected ? .white : .blue
        )
        .cornerRadius(8)
        .overlay(
          RoundedRectangle(cornerRadius: 8)
            .stroke(Color.blue, lineWidth: isSelected ? 0 : 1)
        )
    }
    .buttonStyle(PlainButtonStyle())
  }
}

#Preview {
  ShoutoutFiltersView()
}
