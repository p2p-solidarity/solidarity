//
//  RippleButton.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import SwiftUI

enum RippleButtonState: Equatable {
    case idle
    case processing
    case success
    case syncNeeded
}

struct RippleButton: View {
    let state: RippleButtonState
    let commitment: String?
    let onTap: () -> Void
    let onLongPress: () -> Void
    
    @State private var isPressing = false
    @State private var ringActiveCount = 0
    @State private var ringTimer: Timer?
    @State private var rotation: Double = 0
    
    // Constants
    private let longPressDuration: Double = 1.5
    
    var body: some View {
        GeometryReader { geo in
            let base = min(geo.size.width, geo.size.height)
            ZStack {
                // Outer Rings
                if state == .processing {
                    processingRings(size: base * 0.85)
                } else {
                    staticRings(size: base, baseSize: base)
                }
                
                // Center Button
                centerButton(size: base * 0.36)
                
                // Status Label
                VStack {
                    Spacer()
                    statusLabel
                        .padding(.top, base * 0.5) // Push below the button
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onChange(of: state) { _, newValue in
            if newValue == .processing {
                withAnimation(.linear(duration: 2).repeatForever(autoreverses: false)) {
                    rotation = 360
                }
            } else {
                rotation = 0
            }
        }
    }
    
    // MARK: - Rings
    
    private func staticRings(size: CGFloat, baseSize: CGFloat) -> some View {
        ZStack {
            ringView(size: baseSize * 0.80, index: 3)
            ringView(size: baseSize * 0.62, index: 2)
            ringView(size: baseSize * 0.46, index: 1)
        }
    }
    
    private func processingRings(size: CGFloat) -> some View {
        ZStack {
            Circle()
                .trim(from: 0, to: 0.7)
                .stroke(
                    AngularGradient(colors: [.accentColor, .accentColor.opacity(0)], center: .center),
                    style: StrokeStyle(lineWidth: 4, lineCap: .round)
                )
                .frame(width: size, height: size)
                .rotationEffect(.degrees(rotation))
            
            Circle()
                .trim(from: 0, to: 0.7)
                .stroke(
                    AngularGradient(colors: [.purple, .purple.opacity(0)], center: .center),
                    style: StrokeStyle(lineWidth: 4, lineCap: .round)
                )
                .frame(width: size * 0.7, height: size * 0.7)
                .rotationEffect(.degrees(-rotation * 1.5))
        }
    }
    
    private func ringView(size: CGFloat, index: Int) -> some View {
        let isSyncNeeded = state == .syncNeeded
        let color: Color = isSyncNeeded ? .orange : .gray
        
        return Circle()
            .stroke(lineWidth: 8)
            .foregroundColor(
                index == 1
                ? color.opacity(0.2)
                : (index <= ringActiveCount ? (isSyncNeeded ? .orange : .accentColor) : color.opacity(0.1))
            )
            .frame(width: size, height: size)
            .animation(.easeInOut(duration: 0.3), value: ringActiveCount)
    }
    
    // MARK: - Center Button
    
    private func centerButton(size: CGFloat) -> some View {
        ZStack {
            // Background
            Circle()
                .fill(buttonGradient)
                .frame(width: size, height: size)
                .shadow(color: shadowColor, radius: isPressing ? 20 : 10)
            
            // Content
            if state == .success {
                Image(systemName: "checkmark")
                    .font(.system(size: size * 0.4, weight: .bold))
                    .foregroundColor(.white)
                    .transition(.scale.combined(with: .opacity))
            } else if state == .processing {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    .scaleEffect(1.5)
            } else {
                VStack(spacing: 6) {
                    Text("ID")
                        .font(.title2.weight(.bold))
                        .foregroundColor(.white)
                        .shadow(color: .black.opacity(0.35), radius: 3, x: 0, y: 1)

                    if let commitment = commitment, !commitment.isEmpty {
                        VStack(spacing: 4) {
                            Text("Commitment")
                                .font(.caption2)
                                .foregroundColor(.white.opacity(0.9))
                            Text(shortCommitment(commitment))
                                .font(.caption.monospaced())
                                .foregroundColor(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.black.opacity(0.20))
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                    } else {
                        Text("Tap to create")
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.9))
                    }
                }
            }
        }
        .scaleEffect(isPressing ? 0.95 : 1.0)
        .animation(.spring(response: 0.3, dampingFraction: 0.6), value: isPressing)
        .onTapGesture {
            if state != .processing {
                onTap()
            }
        }
        .onLongPressGesture(minimumDuration: longPressDuration, maximumDistance: 50, pressing: { pressing in
            if state != .processing {
                isPressing = pressing
                if pressing {
                    startRingAnimation()
                    #if canImport(UIKit)
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    #endif
                } else {
                    stopRingAnimation(reset: false)
                }
            }
        }, perform: {
            if state != .processing {
                #if canImport(UIKit)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                #endif
                stopRingAnimation(reset: false)
                onLongPress()
            }
        })
    }
    
    // MARK: - Status Label
    
    private var statusLabel: some View {
        Group {
            switch state {
            case .idle:
                if commitment == nil {
                    Text("Identity Not Created")
                        .foregroundColor(.secondary)
                } else {
                    Text("Identity Active")
                        .foregroundColor(.green)
                }
            case .processing:
                Text("Processing...")
                    .foregroundColor(.primary)
            case .success:
                Text("Success!")
                    .foregroundColor(.green)
            case .syncNeeded:
                Text("Sync Needed")
                    .foregroundColor(.orange)
            }
        }
        .font(.caption.weight(.medium))
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.ultraThinMaterial)
        .clipShape(Capsule())
    }
    
    // MARK: - Helpers
    
    private var buttonGradient: LinearGradient {
        switch state {
        case .idle:
            return commitment == nil
                ? LinearGradient(colors: [.gray, .gray.opacity(0.8)], startPoint: .topLeading, endPoint: .bottomTrailing)
                : LinearGradient(colors: [.green.opacity(0.9), .blue.opacity(0.8)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .processing:
            return LinearGradient(colors: [.blue, .purple], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .success:
            return LinearGradient(colors: [.green, .mint], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .syncNeeded:
            return LinearGradient(colors: [.orange, .red], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }
    
    private var shadowColor: Color {
        switch state {
        case .syncNeeded: return .orange.opacity(isPressing ? 0.6 : 0.3)
        default: return .accentColor.opacity(isPressing ? 0.6 : 0.25)
        }
    }
    
    private func startRingAnimation() {
        ringActiveCount = 1
        ringTimer?.invalidate()
        ringTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { timer in
            ringActiveCount = min(3, ringActiveCount + 1)
            if ringActiveCount >= 3 { timer.invalidate() }
        }
    }
    
    private func stopRingAnimation(reset: Bool) {
        ringTimer?.invalidate()
        ringTimer = nil
        if reset { ringActiveCount = 0 }
    }
    
    private func shortCommitment(_ value: String) -> String {
        guard value.count > 12 else { return value }
        let start = value.prefix(6)
        let end = value.suffix(6)
        return String(start) + "…" + String(end)
    }
}
