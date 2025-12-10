//
//  FocusedCardView.swift
//  airmeishi
//
//  Centered single-card focus overlay with edit and swipe-to-delete
//

import SwiftUI

struct FocusedCardView: View {
    let card: BusinessCard
    let onEdit: () -> Void
    let onDelete: () -> Void
    let onClose: () -> Void

    @GestureState private var dragOffset: CGSize = .zero
    @EnvironmentObject private var theme: ThemeManager
    @State private var showingActionMenu = false

    init(card: BusinessCard, onEdit: @escaping () -> Void, onDelete: @escaping () -> Void, onClose: @escaping () -> Void) {
        self.card = card
        self.onEdit = onEdit
        self.onDelete = onDelete
        self.onClose = onClose
    }

    var body: some View {
        // Removed debug print to reduce body re-evaluation overhead
        bodyContent
    }

    private var bodyContent: some View {
        VStack(spacing: 20) {
            // Main card with enhanced design
            ZStack(alignment: .topTrailing) {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(gradient(card))
                    .overlay(
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .stroke(
                                LinearGradient(
                                    colors: [theme.cardAccent.opacity(0.6), theme.cardAccent.opacity(0.2)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                lineWidth: 2
                            )
                    )
                    .cardGlow(theme.cardAccent, enabled: theme.enableGlow)
                    .shadow(color: theme.cardAccent.opacity(0.3), radius: 20, x: 0, y: 10)
                    .frame(height: 280)
                    .overlay { cardContent() }
                    .offset(x: dragOffset.width)
                    .rotation3DEffect(
                        .degrees(Double(dragOffset.width) / 20),
                        axis: (x: 0, y: 1, z: 0)
                    )
                    .gesture(
                        DragGesture()
                            .updating($dragOffset) { value, state, _ in
                                state = value.translation
                            }
                            .onEnded { value in
                                if value.translation.width < -100 { onDelete() }
                                if value.translation.width > 100 { onEdit() }
                            }
                    )
            }

            // Action buttons with black/white design
            HStack(spacing: 16) {
                Button(action: onClose) {
                    HStack(spacing: 8) {
                        Image(systemName: "xmark.circle.fill")
                        Text("Close")
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.white.opacity(0.2))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(Color.white.opacity(0.3), lineWidth: 1)
                    )
                }

                Button(action: onEdit) {
                    HStack(spacing: 8) {
                        Image(systemName: "pencil.circle.fill")
                        Text("Edit")
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .shadow(color: .black.opacity(0.2), radius: 8, x: 0, y: 4)
                }

                Button(action: onDelete) {
                    HStack(spacing: 8) {
                        Image(systemName: "trash.circle.fill")
                        Text("Delete")
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.red.opacity(0.9))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .shadow(color: .red.opacity(0.4), radius: 8, x: 0, y: 4)
                }
            }
            .padding(.horizontal, 4)

            // Swipe hint
            Text("← Swipe to delete • Swipe to edit →")
                .font(.caption)
                .foregroundColor(.white.opacity(0.6))
                .padding(.top, 4)
        }
        .padding(.horizontal, 8)
    }
    
    @ViewBuilder
    private func cardContent() -> some View {
        HStack(alignment: .top, spacing: 14) {
            if let animal = card.animal {
                ImageProvider.animalImage(for: animal)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 72, height: 72)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(card.name).font(.title2.weight(.bold)).foregroundColor(.black)
                if let company = card.company { Text(company).foregroundColor(.black.opacity(0.7)) }
                if let title = card.title { Text(title).font(.subheadline).foregroundColor(.black.opacity(0.6)) }
                Spacer()
                HStack {
                    if let email = card.email { label("envelope", email) }
                    Spacer(minLength: 8)
                    if let phone = card.phone { label("phone", phone) }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(18)
        .overlay(alignment: .topTrailing) {
            if let groupName = linkedGroupName() {
                Text(groupName)
                    .font(.caption2.weight(.bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.black.opacity(0.6))
                    .clipShape(Capsule())
                    .padding(12)
            }
        }
    }
    
    private func label(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).foregroundColor(.black.opacity(0.7))
            Text(text).font(.caption).foregroundColor(.black.opacity(0.8))
        }
        .padding(8)
        .background(Color.white.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
    
    private func gradient(_ card: BusinessCard) -> LinearGradient {
        let hash = card.id.uuidString.hashValue
        let hue = Double(abs(hash % 360)) / 360.0
        let c1 = Color(hue: hue, saturation: 0.7, brightness: 1.0)
        let c2 = Color.white
        return LinearGradient(colors: [c2, c1.opacity(0.3)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
    
    private func linkedGroupName() -> String? {
        if let tag = card.categories.first(where: { $0.hasPrefix("group:") }) {
            let uuidString = String(tag.dropFirst("group:".count))
            if let id = UUID(uuidString: uuidString),
               let group = CloudKitGroupSyncManager.shared.getAllGroups().first(where: { $0.id == id.uuidString }) {
                return group.name
            }
        }
        return nil
    }
}


