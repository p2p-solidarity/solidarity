//
//  AnimalSelectorView.swift
//  airmeishi
//
//  Horizontal picker of animal characters with image previews.
//

import SwiftUI

struct AnimalSelectorView: View {
  @Binding var selection: AnimalCharacter

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 12) {
        ForEach(AnimalCharacter.allCases) { animal in
          AnimalChip(animal: animal, isSelected: animal == selection)
            .onTapGesture { selection = animal }
        }
      }
      .padding(.vertical, 4)
    }
  }
}

private struct AnimalChip: View {
  let animal: AnimalCharacter
  let isSelected: Bool

  var body: some View {
    HStack(spacing: 8) {
      ImageProvider.animalImage(for: animal)
        .resizable()
        .scaledToFill()
        .frame(width: 36, height: 24)
        .clipped()
        .cornerRadius(12)
        .overlay(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(Color.white.opacity(isSelected ? 0.6 : 0.25), lineWidth: 1)
        )
      Text(animal.displayName)
        .font(.caption.weight(.semibold))
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .background(
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .fill(Color.white.opacity(isSelected ? 0.16 : 0.08))
    )
    .overlay(
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .stroke(Color.white.opacity(isSelected ? 0.6 : 0.25), lineWidth: 1)
    )
  }
}

#Preview {
  StatefulPreviewWrapper(AnimalCharacter.dog) { sel in
    AnimalSelectorView(selection: sel)
      .padding()
      .background(Color.black)
      .preferredColorScheme(.dark)
  }
}

// Helper for previews with @Binding
struct StatefulPreviewWrapper<Value, Content: View>: View {
  @State var value: Value
  var content: (Binding<Value>) -> Content
  init(_ value: Value, content: @escaping (Binding<Value>) -> Content) {
    _value = State(initialValue: value)
    self.content = content
  }
  var body: some View {
    content($value)
  }
}
