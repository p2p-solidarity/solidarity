//
//  ShareCardPickerSheet.swift
//  airmeishi
//
//  Sheet to start/stop advertising the first business card at a chosen privacy level.
//

import SwiftUI

struct ShareCardPickerSheet: View {
    let cards: [BusinessCard]
    let onStart: (BusinessCard, SharingLevel) -> Void
    let onStop: () -> Void
    let isAdvertising: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var level: SharingLevel = .professional
    
    private var firstCard: BusinessCard? {
        cards.first
    }
    
    var body: some View {
        NavigationView {
            Form {
                Section("Privacy Level") {
                    Picker("Level", selection: $level) {
                        ForEach(SharingLevel.allCases, id: \.self) { lvl in
                            Text(lvl.displayName).tag(lvl)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                if let card = firstCard {
                    Section("Preview") {
                        BusinessCardPreview(businessCard: card.filteredCard(for: level))
                    }
                } else {
                    Section {
                        Text("No card available")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Privacy Level")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .navigationBarTrailing) {
                    if isAdvertising {
                        Button("Stop") { onStop(); dismiss() }
                    } else {
                        Button("Start") {
                            if let card = firstCard {
                                onStart(card, level)
                                dismiss()
                            }
                        }
                        .disabled(firstCard == nil)
                    }
                }
            }
        }
    }
}
