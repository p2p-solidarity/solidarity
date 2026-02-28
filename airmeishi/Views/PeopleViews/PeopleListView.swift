//
//  PeopleListView.swift
//  airmeishi
//
//  Tab root - contact gallery reusing ShoutoutChartService, LighteningCardView, ContactRowView
//

import SwiftUI

struct PeopleListView: View {
  @StateObject private var chartService = ShoutoutChartService.shared
  @Environment(\.colorScheme) private var colorScheme
  @State private var selectedUser: ShoutoutUser?
  @State private var displayMode: DisplayMode = .list
  @State private var isSakuraAnimating = false
  @State private var showingProximitySharing = false

  var body: some View {
    NavigationStack {
      ZStack {
        Color.Theme.pageBg
          .ignoresSafeArea()

        VStack(spacing: 0) {
          headerSection
          cardGallery
        }
      }
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .principal) {
          Text("people list")
            .font(.system(size: 18))
            .foregroundColor(Color.Theme.textPrimary)
        }
        ToolbarItem(placement: .navigationBarTrailing) {
          Button(action: { showingProximitySharing = true }) {
            Image(systemName: "plus")
              .font(.system(size: 18, weight: .medium))
              .foregroundColor(Color.Theme.darkUI)
          }
        }
      }
    }
    .onAppear { isSakuraAnimating = true }
    .sheet(item: $selectedUser) { user in
      PersonDetailView(user: user)
    }
    .fullScreenCover(isPresented: $showingProximitySharing) {
      ProximitySharingView()
    }
  }

  // MARK: - Header

  private var headerSection: some View {
    VStack(spacing: 0) {
      // Search bar
      HStack(spacing: 10) {
        Image(systemName: "magnifyingglass")
          .foregroundColor(Color.Theme.textPlaceholder)

        TextField("搜索", text: $chartService.searchQuery)
          .textFieldStyle(PlainTextFieldStyle())
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textPrimary)

        if !chartService.searchQuery.isEmpty {
          Button(action: { chartService.searchQuery = "" }) {
            Image(systemName: "xmark.circle.fill")
              .foregroundColor(Color.Theme.textPlaceholder)
          }
        }
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 10)
      .background(
        RoundedRectangle(cornerRadius: 2, style: .continuous)
          .fill(Color.Theme.searchBg)
      )
      .padding(.horizontal, 16)
      .padding(.bottom, 12)
    }
  }

  // MARK: - Card Gallery

  private var cardGallery: some View {
    ScrollView {
      if chartService.filteredData.isEmpty {
        emptyState
      } else {
        listView
      }
    }
  }

  private var emptyState: some View {
    VStack(spacing: 20) {
      Spacer().frame(height: 40)

      Image(systemName: "folder")
        .font(.system(size: 44, weight: .light))
        .foregroundColor(Color.Theme.textTertiary)

      VStack(spacing: 6) {
        Text("你的聯絡人通訊錄是空的")
          .font(.system(size: 16, weight: .medium))
          .foregroundColor(Color.Theme.textPrimary)

        Text("匯入或手動新增聯絡人")
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textSecondary)
          .multilineTextAlignment(.center)
      }

      VStack(spacing: 14) {
        Button(action: { showingProximitySharing = true }) {
          Text("匯入手機通訊錄")
            .font(.system(size: 15, weight: .medium))
            .foregroundColor(.white)
            .frame(maxWidth: 260)
            .padding(.vertical, 14)
            .background(
              RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.Theme.accentRose)
            )
        }

        Button(action: { showingProximitySharing = true }) {
          Text("手動新增")
            .font(.system(size: 15, weight: .medium))
            .foregroundColor(Color.Theme.accentRose)
            .frame(maxWidth: 260)
            .padding(.vertical, 14)
            .background(
              RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color.Theme.accentRose, lineWidth: 1)
            )
        }
      }
      .padding(.top, 4)
    }
  }

  private var listView: some View {
    LazyVStack(spacing: 0) {
      ForEach(chartService.filteredData) { dataPoint in
        ContactRowView(
          dataPoint: dataPoint,
          isLighteningAnimating: isSakuraAnimating
        ) {
          let impact = UIImpactFeedbackGenerator(style: .light)
          impact.impactOccurred()
          selectedUser = dataPoint.user
        }
      }
    }
    .adaptivePadding(horizontal: 16, vertical: 0)
    .adaptiveMaxWidth(800)
    .padding(.bottom, 100)
  }
}
