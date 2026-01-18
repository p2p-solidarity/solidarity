//
//  ShoutoutView.swift
//  airmeishi
//
//  Ichigoichie (Sakura) gallery view for business card discovery and management
//

import Combine
import CryptoKit
import SwiftUI

enum DisplayMode {
  case grid
  case list
}

struct ShoutoutView: View {
  @StateObject private var chartService = ShoutoutChartService.shared
  @State private var selectedUser: ShoutoutUser?
  @State private var searchText = ""
  @State private var showingCreateShoutout = false
  @State private var selectedContact: Contact?
  @State private var isSakuraAnimating = false
  @State private var displayMode: DisplayMode = .grid

  var body: some View {
    NavigationView {
      ZStack {
        // Dark gradient background with lightning effect
        LinearGradient(
          colors: [
            Color.black,
            Color.purple.opacity(0.15),
            Color.blue.opacity(0.1),
            Color.black,
          ],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
        .ignoresSafeArea()

        VStack(spacing: 0) {
          // Header
          lightningHeader

          // Card Gallery or List
          cardGallery
        }

        // Floating Action Button
        VStack {
          Spacer()
          HStack {
            Spacer()
            headerSakuraButton
              .padding(.trailing, 24)
              .padding(.bottom, 24)
          }
        }
      }
      .navigationBarHidden(true)
      .sheet(isPresented: $showingCreateShoutout) {
        CreateShoutoutView(selectedUser: selectedUser)
      }

    }
    .preferredColorScheme(.dark)
    .onAppear {
      startSakuraAnimation()
    }
    .sheet(item: $selectedUser) { user in
      ShoutoutDetailView(user: user)
    }
  }

  // MARK: - Sakura Header

  private var lightningHeader: some View {
    VStack(spacing: 16) {
      // Animated sakura title with grid/list toggle
      HStack {
        SakuraIconView(size: 28, color: .pink, isAnimating: isSakuraAnimating)

        Text("Sakura Ichigoichie")
          .font(.title2)
          .fontWeight(.bold)
          .foregroundColor(.white)

        Spacer()

        // View toggle
        HStack(spacing: 0) {
          Button(action: { displayMode = .grid }) {
            Image(systemName: "square.grid.2x2")
              .padding(8)
              .background(displayMode == .grid ? Color.pink.opacity(0.2) : Color.clear)
              .cornerRadius(8)
          }

          Button(action: { displayMode = .list }) {
            Image(systemName: "list.bullet")
              .padding(8)
              .background(displayMode == .list ? Color.pink.opacity(0.2) : Color.clear)
              .cornerRadius(8)
          }
        }
        .foregroundColor(.white)
        .background(Color.white.opacity(0.1))
        .cornerRadius(8)

        Button(action: {
          chartService.refreshData()
          let impact = UIImpactFeedbackGenerator(style: .medium)
          impact.impactOccurred()
        }) {
          Image(systemName: "arrow.triangle.2.circlepath")
            .font(.title2)
            .foregroundColor(.white)
        }

        // Live count with pulsing effect
        HStack(spacing: 4) {
          Circle()
            .fill(Color.green)
            .frame(width: 8, height: 8)
            .scaleEffect(isSakuraAnimating ? 1.3 : 1.0)
            .animation(
              .easeInOut(duration: 1.0).repeatForever(autoreverses: true),
              value: isSakuraAnimating
            )

          Text("\(chartService.filteredData.count) cards")
            .font(.caption)
            .foregroundColor(.gray)
        }
      }
      .padding(.horizontal)

      // Search bar with sakura accent
      HStack {
        Image(systemName: "magnifyingglass")
          .foregroundColor(.pink)

        TextField("Search contacts, companies...", text: $chartService.searchQuery)
          .textFieldStyle(PlainTextFieldStyle())
          .foregroundColor(.white)

        if !chartService.searchQuery.isEmpty {
          Button(action: {
            chartService.searchQuery = ""
          }) {
            Image(systemName: "xmark.circle.fill")
              .foregroundColor(.gray)
          }
        }

        // Filter button
        Menu(
          content: {
            Button(action: { chartService.filterOption = .all }) {
              Label("All Cards", systemImage: "rectangle.stack")
            }
            Button(action: { chartService.filterOption = .verified }) {
              Label("Verified Only", systemImage: "checkmark.seal.fill")
            }
            Button(action: { chartService.filterOption = .recent }) {
              Label("Recently Added", systemImage: "clock")
            }
          },
          label: {
            HStack {
              Image(systemName: "line.3.horizontal.decrease.circle")
              Text(chartService.filterOption.rawValue)
            }
            .font(.caption)
            .foregroundColor(.gray)
          }
        )
      }
      .adaptivePadding(horizontal: 16, vertical: 0)
      .padding(.vertical, 12)
      .background(
        RoundedRectangle(cornerRadius: 12)
          .fill(Color.white.opacity(0.08))
          .overlay(
            RoundedRectangle(cornerRadius: 12)
              .stroke(
                LinearGradient(
                  colors: [.pink.opacity(0.5), .purple.opacity(0.5)],
                  startPoint: .leading,
                  endPoint: .trailing
                ),
                lineWidth: 1
              )
          )
      )
      .padding(.horizontal)
    }
    .padding(.vertical)
  }

  // MARK: - Header Sakura Button

  private var headerSakuraButton: some View {
    Button(action: { showingCreateShoutout = true }) {
      ZStack {
        Circle()
          .fill(
            LinearGradient(
              colors: [.pink, .purple],
              startPoint: .topLeading,
              endPoint: .bottomTrailing
            )
          )
          .frame(width: 50, height: 50)
          .shadow(color: .pink.opacity(0.5), radius: 6, x: 0, y: 0)

        SakuraIconView(size: 20, color: .white, isAnimating: isSakuraAnimating)
      }
    }
  }

  // MARK: - Card Gallery

  private var cardGallery: some View {
    ScrollView {
      if chartService.filteredData.isEmpty {
        VStack(spacing: 16) {
          SakuraIconView(size: 60, color: .gray, isAnimating: false)
            .padding(.top, 60)

          Text("No cards found")
            .font(.title3)
            .foregroundColor(.gray)

          Text("Try adjusting your search or filters")
            .font(.caption)
            .foregroundColor(.gray.opacity(0.6))
        }
      } else {
        switch displayMode {
        case .grid:
          gridView
        case .list:
          listView
        }
      }
    }
  }

  private var gridView: some View {
    AdaptiveGrid(spacing: 16) {
      ForEach(chartService.filteredData) { dataPoint in
        LighteningCardView(
          dataPoint: dataPoint,
          isLighteningAnimating: isSakuraAnimating
        ) {
          // Haptic feedback
          let impact = UIImpactFeedbackGenerator(style: .light)
          impact.impactOccurred()

          selectedUser = dataPoint.user
        }
      }
    }
    .adaptivePadding(horizontal: 16, vertical: 0)
  }

  private var listView: some View {
    LazyVStack(spacing: 12) {
      ForEach(chartService.filteredData) { dataPoint in
        ContactRowView(
          dataPoint: dataPoint,
          isLighteningAnimating: isSakuraAnimating
        ) {
          // Haptic feedback
          let impact = UIImpactFeedbackGenerator(style: .light)
          impact.impactOccurred()

          selectedUser = dataPoint.user
        }
      }
    }
    .adaptivePadding(horizontal: 16, vertical: 0)
    .adaptiveMaxWidth(800)
  }

  // MARK: - Animation Control

  private func startSakuraAnimation() {
    isSakuraAnimating = true
  }
}

#Preview {
  ShoutoutView()
}
