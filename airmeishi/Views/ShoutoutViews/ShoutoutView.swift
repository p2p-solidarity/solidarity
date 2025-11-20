//
//  ShoutoutView.swift
//  airmeishi
//
//  Ichigoichie (Sakura) gallery view for business card discovery and management
//

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
                        Color.blue.opacity(0.1),
                        Color.purple.opacity(0.05),
                        Color.black
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
                
                VStack(spacing: 0) {
                    // Lightening header with search
                    lightningHeader
                    
                    // Business card gallery
                    cardGallery
                }
            }

            .navigationBarTitleDisplayMode(.large)
            .sheet(item: $selectedUser) { user in
                ShoutoutDetailView(user: user)
            }
            .sheet(isPresented: $showingCreateShoutout) {
                CreateShoutoutView(selectedUser: selectedUser)
            }
            .overlay(alignment: .bottomTrailing) {
                // Floating sakura action button
                sakuraActionButton
                    .padding(.trailing, 20)
                    .padding(.bottom, 30)
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            startSakuraAnimation()
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
                
                // Display mode toggle
                Button(action: {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                        displayMode = displayMode == .grid ? .list : .grid
                    }
                }) {
                    Image(systemName: displayMode == .grid ? "list.bullet" : "square.grid.2x2")
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
                
                TextField("Search business cards...", text: $searchText)
                    .textFieldStyle(PlainTextFieldStyle())
                    .foregroundColor(.white)
                    .onChange(of: searchText) { _, newValue in
                        chartService.searchUsers(query: newValue)
                    }
                
                if !searchText.isEmpty {
                    Button("Clear") {
                        searchText = ""
                        chartService.searchUsers(query: "")
                    }
                    .font(.caption)
                    .foregroundColor(.gray)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.white.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(
                                LinearGradient(
                                    colors: [.pink.opacity(0.3), .clear, .pink.opacity(0.3)],
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
    
    // MARK: - Card Gallery

    private var cardGallery: some View {
        ScrollView {
            if chartService.filteredData.isEmpty {
                VStack(spacing: 16) {
                    SakuraIconView(size: 60, color: .gray, isAnimating: false)
                        .padding(.top, 60)

                    Text("No cards found")
                        .font(.title3)
                        .fontWeight(.semibold)
                        .foregroundColor(.white)

                    Text("Be the first to share your business card!")
                        .font(.body)
                        .foregroundColor(.gray)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 40)
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
        LazyVGrid(columns: [
            GridItem(.flexible(), spacing: 16),
            GridItem(.flexible(), spacing: 16)
        ], spacing: 16) {
            ForEach(chartService.filteredData) { dataPoint in
                LighteningCardView(
                    dataPoint: dataPoint,
                    isLighteningAnimating: isSakuraAnimating
                ) {
                    // Add haptic feedback
                    let impact = UIImpactFeedbackGenerator(style: .light)
                    impact.impactOccurred()
                    
                    selectedUser = dataPoint.user
                }
            }
        }
        .padding(.horizontal)
    }
    
    private var listView: some View {
        LazyVStack(spacing: 12) {
            ForEach(chartService.filteredData) { dataPoint in
                ContactRowView(
                    dataPoint: dataPoint,
                    isLighteningAnimating: isSakuraAnimating
                ) {
                    // Add haptic feedback
                    let impact = UIImpactFeedbackGenerator(style: .light)
                    impact.impactOccurred()
                    
                    selectedUser = dataPoint.user
                }
            }
        }
        .padding(.horizontal)
    }
    
    // MARK: - Floating Sakura Action Button
    
    private var sakuraActionButton: some View {
        Button(action: { showingCreateShoutout = true }) {
            ZStack {
                // Sakura background
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [.pink.opacity(0.8), .purple.opacity(0.6), .pink.opacity(0.8)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 60, height: 60)
                    .shadow(color: .pink.opacity(0.5), radius: 10, x: 0, y: 0)
                
                // Sakura icon
                SakuraIconView(size: 30, color: .white, isAnimating: isSakuraAnimating)
            }
        }
    }
    
    // MARK: - Animation Control
    
    private func startSakuraAnimation() {
        isSakuraAnimating = true
    }
}

// MARK: - Lightening Card View

struct LighteningCardView: View {
    let dataPoint: ChartDataPoint
    let isLighteningAnimating: Bool
    let onTap: () -> Void
    
    @State private var cardOffset: CGFloat = 0
    @State private var isHovering = false
    
    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 12) {
                // Card header with lightning effect
                HStack {
                    // Profile image with lightning border
                    AsyncImage(url: dataPoint.user.profileImageURL) { image in
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    } placeholder: {
                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: [dataPoint.color, dataPoint.color.opacity(0.6)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .overlay {
                                Text(dataPoint.user.initials)
                                    .font(.headline)
                                    .fontWeight(.bold)
                                    .foregroundColor(.white)
                            }
                    }
                    .frame(width: 50, height: 50)
                    .clipShape(Circle())
                    .overlay(
                        Circle()
                            .stroke(
                                isLighteningAnimating ? Color.pink : dataPoint.color,
                                lineWidth: isLighteningAnimating ? 3 : 2
                            )
                            .scaleEffect(isLighteningAnimating ? 1.1 : 1.0)
                            .animation(
                                .easeInOut(duration: 0.5).repeatForever(autoreverses: true),
                                value: isLighteningAnimating
                            )
                    )
                    .shadow(
                        color: isLighteningAnimating ? .pink.opacity(0.6) : dataPoint.color.opacity(0.5),
                        radius: isLighteningAnimating ? 8 : 4,
                        x: 0, y: 2
                    )
                    
                    Spacer()
                    
                    // Sakura indicator
                    SakuraIconView(size: 16, color: isLighteningAnimating ? .pink : .gray, isAnimating: isLighteningAnimating)
                }
                
                // User info with fixed spacing
                VStack(alignment: .leading, spacing: 4) {
                    Text(dataPoint.user.name)
                        .font(.headline)
                        .fontWeight(.semibold)
                        .foregroundColor(.white)
                        .lineLimit(1)
                    
                    // Always reserve space for company, even if empty
                    Text(dataPoint.user.company.isEmpty ? " " : dataPoint.user.company)
                        .font(.caption)
                        .foregroundColor(dataPoint.user.company.isEmpty ? .clear : .gray)
                        .lineLimit(1)
                        .frame(height: 14)
                    
                    // Always reserve space for title, even if empty
                    Text(dataPoint.user.title.isEmpty ? " " : dataPoint.user.title)
                        .font(.caption2)
                        .foregroundColor(dataPoint.user.title.isEmpty ? .clear : .gray.opacity(0.8))
                        .lineLimit(1)
                        .frame(height: 12)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                
                Spacer(minLength: 0)
                
                // Verification status with lightning effect
                HStack {
                    Image(systemName: dataPoint.user.verificationStatus.systemImageName)
                        .foregroundColor(verificationColor)
                        .font(.caption)
                    
                    Text(dataPoint.user.verificationStatus.displayName)
                        .font(.caption2)
                        .foregroundColor(.gray)
                    
                    Spacer()
                    
                    // Score indicator
                    HStack(spacing: 2) {
                        ForEach(0..<3) { index in
                            Circle()
                                .fill(index < Int(dataPoint.user.eventScore * 3) ? Color.pink : Color.gray.opacity(0.3))
                                .frame(width: 4, height: 4)
                        }
                    }
                }
            }
            .padding(16)
            .frame(height: 180)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color.white.opacity(0.05))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(
                                isLighteningAnimating ? Color.yellow.opacity(0.3) : Color.white.opacity(0.1),
                                lineWidth: 1
                            )
                    )
            )
            .scaleEffect(isHovering ? 1.05 : 1.0)
            .offset(y: cardOffset)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovering)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: cardOffset)
        }
        .buttonStyle(PlainButtonStyle())
        .onHover { hovering in
            isHovering = hovering
        }
        .onTapGesture {
            withAnimation(.spring(response: 0.2, dampingFraction: 0.6)) {
                cardOffset = -5
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                    cardOffset = 0
                }
            }
            onTap()
        }
    }
    
    private var verificationColor: Color {
        switch dataPoint.user.verificationStatus {
        case .verified: return .green
        case .pending: return .orange
        case .unverified: return .blue
        case .failed: return .red
        }
    }
}

// MARK: - Contact Row View

struct ContactRowView: View {
    let dataPoint: ChartDataPoint
    let isLighteningAnimating: Bool
    let onTap: () -> Void
    
    @State private var isHovering = false
    
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 16) {
                // Profile image with lightning border
                AsyncImage(url: dataPoint.user.profileImageURL) { image in
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } placeholder: {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [dataPoint.color, dataPoint.color.opacity(0.6)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .overlay {
                            Text(dataPoint.user.initials)
                                .font(.headline)
                                .fontWeight(.bold)
                                .foregroundColor(.white)
                        }
                }
                .frame(width: 60, height: 60)
                .clipShape(Circle())
                    .overlay(
                        Circle()
                            .stroke(
                                isLighteningAnimating ? Color.pink : dataPoint.color,
                                lineWidth: isLighteningAnimating ? 3 : 2
                            )
                            .scaleEffect(isLighteningAnimating ? 1.1 : 1.0)
                            .animation(
                                .easeInOut(duration: 0.5).repeatForever(autoreverses: true),
                                value: isLighteningAnimating
                            )
                    )
                    .shadow(
                        color: isLighteningAnimating ? .pink.opacity(0.6) : dataPoint.color.opacity(0.5),
                        radius: isLighteningAnimating ? 8 : 4,
                        x: 0, y: 2
                    )
                
                // User info
                VStack(alignment: .leading, spacing: 4) {
                    Text(dataPoint.user.name)
                        .font(.headline)
                        .fontWeight(.semibold)
                        .foregroundColor(.white)
                        .lineLimit(1)
                    
                    HStack(spacing: 8) {
                        if !dataPoint.user.company.isEmpty {
                            Text(dataPoint.user.company)
                                .font(.subheadline)
                                .foregroundColor(.gray)
                                .lineLimit(1)
                        }
                        
                        if !dataPoint.user.title.isEmpty {
                            Text("•")
                                .font(.subheadline)
                                .foregroundColor(.gray.opacity(0.5))
                            
                            Text(dataPoint.user.title)
                                .font(.subheadline)
                                .foregroundColor(.gray)
                                .lineLimit(1)
                        }
                    }
                    
                    // Verification status and score
                    HStack(spacing: 8) {
                        Image(systemName: dataPoint.user.verificationStatus.systemImageName)
                            .foregroundColor(verificationColor)
                            .font(.caption)
                        
                        Text(dataPoint.user.verificationStatus.displayName)
                            .font(.caption2)
                            .foregroundColor(.gray)
                        
                        // Score indicator
                        HStack(spacing: 2) {
                        ForEach(0..<3) { index in
                            Circle()
                                .fill(index < Int(dataPoint.user.eventScore * 3) ? Color.pink : Color.gray.opacity(0.3))
                                .frame(width: 4, height: 4)
                        }
                        }
                    }
                }
                
                Spacer()
                
                // Sakura indicator
                SakuraIconView(size: 24, color: isLighteningAnimating ? .pink : .gray, isAnimating: isLighteningAnimating)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.white.opacity(0.05))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(
                                isLighteningAnimating ? Color.yellow.opacity(0.3) : Color.white.opacity(0.1),
                                lineWidth: 1
                            )
                    )
            )
            .scaleEffect(isHovering ? 1.02 : 1.0)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovering)
        }
        .buttonStyle(PlainButtonStyle())
        .onHover { hovering in
            isHovering = hovering
        }
    }
    
    private var verificationColor: Color {
        switch dataPoint.user.verificationStatus {
        case .verified: return .green
        case .pending: return .orange
        case .unverified: return .blue
        case .failed: return .red
        }
    }
}

// MARK: - Create Shoutout View

struct CreateShoutoutView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var recipient: ShoutoutUser?
    @State private var message = ""
    @State private var showingUserPicker = false
    @State private var isSakuraAnimating = false
    @State private var showingSuccess = false
    
    init(selectedUser: ShoutoutUser? = nil) {
        self._recipient = State(initialValue: selectedUser)
    }
    
    var body: some View {
        NavigationView {
            ZStack {
                // Dark background with lightning effect
                LinearGradient(
                    colors: [
                        Color.black,
                        Color.purple.opacity(0.1),
                        Color.blue.opacity(0.05),
                        Color.black
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
                
                VStack(spacing: 24) {
                    // Sakura header
                    sakuraHeader
                    
                    // Recipient Selection
                    recipientSelection
                    
                    // Message Input
                    messageInput
                    
                    Spacer()
                    
                    // Send Button with sakura effect
                    sakuraSendButton
                }
                .padding()
            }
            .navigationTitle("Sakura Ichigoichie")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .sheet(isPresented: $showingUserPicker) {
                UserPickerView(selectedUser: $recipient)
            }
            .alert("Sakura Sent!", isPresented: $showingSuccess) {
                Button("OK") {
                    dismiss()
                }
            } message: {
                Text("Your Ichigoichie message has been delivered! 🌸")
            }
            .onAppear {
                startSakuraAnimation()
            }
        }
        .preferredColorScheme(.dark)
    }
    
    // MARK: - Sakura Header
    
    private var sakuraHeader: some View {
        HStack {
            SakuraIconView(size: 32, color: .pink, isAnimating: isSakuraAnimating)
            
            VStack(alignment: .leading, spacing: 2) {
                Text("Send Sakura")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                
                Text("A once-in-a-lifetime encounter 🌸")
                    .font(.caption)
                    .foregroundColor(.gray)
            }
            
            Spacer()
        }
    }
    
    // MARK: - Recipient Selection
    
    private var recipientSelection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Recipient")
                    .font(.headline)
                    .foregroundColor(.white)
                
                Spacer()
                
                Image(systemName: "person.circle.fill")
                    .foregroundColor(.pink)
                    .font(.title3)
            }
            
            Button(action: { showingUserPicker = true }) {
                HStack {
                    if let recipient = recipient {
                        AsyncImage(url: recipient.profileImageURL) { image in
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                        } placeholder: {
                            Circle()
                                .fill(
                                    LinearGradient(
                                        colors: [.blue, .purple],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                                .overlay {
                                    Text(recipient.initials)
                                        .font(.headline)
                                        .foregroundColor(.white)
                                }
                        }
                        .frame(width: 50, height: 50)
                        .clipShape(Circle())
                        .overlay(
                            Circle()
                                .stroke(Color.pink, lineWidth: 2)
                                .scaleEffect(isSakuraAnimating ? 1.1 : 1.0)
                                .animation(
                                    .easeInOut(duration: 0.5).repeatForever(autoreverses: true),
                                    value: isSakuraAnimating
                                )
                        )
                        
                        VStack(alignment: .leading) {
                            Text(recipient.name)
                                .font(.headline)
                                .foregroundColor(.white)
                            
                            Text(recipient.company)
                                .font(.subheadline)
                                .foregroundColor(.gray)
                        }
                    } else {
                        Image(systemName: "person.circle.dashed")
                            .font(.title)
                            .foregroundColor(.gray)
                        
                        Text("Select Recipient")
                            .font(.headline)
                            .foregroundColor(.white)
                    }
                    
                    Spacer()
                    
                    Image(systemName: "chevron.right")
                        .foregroundColor(.gray)
                }
                .padding()
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color.white.opacity(0.05))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.pink.opacity(0.3), lineWidth: 1)
                        )
                )
            }
            .buttonStyle(PlainButtonStyle())
        }
    }
    
    // MARK: - Message Input
    
    private var messageInput: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Sakura Message")
                    .font(.headline)
                    .foregroundColor(.white)
                
                Spacer()
                
                SakuraIconView(size: 24, color: .pink, isAnimating: isSakuraAnimating)
            }
            
            VStack(alignment: .leading, spacing: 8) {
                TextField("A beautiful encounter worth cherishing 🌸", text: $message, axis: .vertical)
                    .textFieldStyle(PlainTextFieldStyle())
                    .foregroundColor(.white)
                    .padding()
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.white.opacity(0.05))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(
                                        isSakuraAnimating ? Color.pink.opacity(0.5) : Color.white.opacity(0.1),
                                        lineWidth: 1
                                    )
                            )
                    )
                    .lineLimit(3...6)
                
                Text("\(message.count)/200 characters")
                    .font(.caption)
                    .foregroundColor(.gray)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }
    
    // MARK: - Sakura Send Button
    
    private var sakuraSendButton: some View {
        Button(action: sendIchigoichie) {
            HStack(spacing: 12) {
                SakuraIconView(size: 24, color: .white, isAnimating: isSakuraAnimating)
                
                Text("Send Sakura")
                    .font(.headline)
                    .fontWeight(.bold)
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(
                        LinearGradient(
                            colors: [.pink.opacity(0.8), .purple.opacity(0.6), .pink.opacity(0.8)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .shadow(color: .pink.opacity(0.5), radius: 10, x: 0, y: 0)
            )
        }
        .disabled(recipient == nil || message.isEmpty || message.count > 200)
        .opacity((recipient == nil || message.isEmpty || message.count > 200) ? 0.5 : 1.0)
    }
    
    // MARK: - Actions
    
    private func sendIchigoichie() {
        // Simulate sending with sakura effect
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
            isSakuraAnimating = true
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            showingSuccess = true
        }
    }
    
    private func startSakuraAnimation() {
        isSakuraAnimating = true
    }
}

// MARK: - User Picker View

struct UserPickerView: View {
    @Binding var selectedUser: ShoutoutUser?
    @Environment(\.dismiss) private var dismiss
    @StateObject private var chartService = ShoutoutChartService.shared
    @State private var searchText = ""
    @State private var isSakuraAnimating = false
    
    var filteredUsers: [ShoutoutUser] {
        if searchText.isEmpty {
            return chartService.users
        } else {
            return chartService.users.filter { user in
                user.name.localizedCaseInsensitiveContains(searchText) ||
                user.company.localizedCaseInsensitiveContains(searchText) ||
                user.title.localizedCaseInsensitiveContains(searchText)
            }
        }
    }
    
    var body: some View {
        NavigationView {
            ZStack {
                // Dark background
                LinearGradient(
                    colors: [Color.black, Color.blue.opacity(0.1)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
                
                VStack(spacing: 0) {
                    // Search bar
                    searchBar
                    
                    // User list
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(filteredUsers) { user in
                                LighteningUserRow(
                                    user: user,
                                    isLighteningAnimating: isSakuraAnimating
                                ) {
                                    selectedUser = user
                                    dismiss()
                                }
                            }
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle("Select Recipient")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .onAppear {
                isSakuraAnimating = true
            }
        }
        .preferredColorScheme(.dark)
    }
    
    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.pink)
            
            TextField("Search contacts...", text: $searchText)
                .textFieldStyle(PlainTextFieldStyle())
                .foregroundColor(.white)
            
            if !searchText.isEmpty {
                Button("Clear") {
                    searchText = ""
                }
                .font(.caption)
                .foregroundColor(.gray)
            }
        }
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.white.opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.pink.opacity(0.3), lineWidth: 1)
                )
        )
        .padding()
    }
}

// MARK: - Lightening User Row

struct LighteningUserRow: View {
    let user: ShoutoutUser
    let isLighteningAnimating: Bool
    let onTap: () -> Void
    
    @State private var isHovering = false
    
    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 16) {
                // Profile image with lightning border
                AsyncImage(url: user.profileImageURL) { image in
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } placeholder: {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [.blue, .purple],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .overlay {
                            Text(user.initials)
                                .font(.headline)
                                .foregroundColor(.white)
                        }
                }
                .frame(width: 60, height: 60)
                .clipShape(Circle())
                .overlay(
                    Circle()
                        .stroke(Color.pink, lineWidth: 2)
                        .scaleEffect(isLighteningAnimating ? 1.1 : 1.0)
                        .animation(
                            .easeInOut(duration: 0.5).repeatForever(autoreverses: true),
                            value: isLighteningAnimating
                        )
                )
                
                // User info
                VStack(alignment: .leading, spacing: 4) {
                    Text(user.name)
                        .font(.headline)
                        .foregroundColor(.white)
                    
                    if !user.company.isEmpty {
                        Text(user.company)
                            .font(.subheadline)
                            .foregroundColor(.gray)
                    }
                    
                    if !user.title.isEmpty {
                        Text(user.title)
                            .font(.caption)
                            .foregroundColor(.gray.opacity(0.8))
                    }
                }
                
                Spacer()
                
                // Sakura and verification
                VStack(spacing: 4) {
                    SakuraIconView(size: 24, color: isLighteningAnimating ? .pink : .gray, isAnimating: isLighteningAnimating)
                    
                    Image(systemName: user.verificationStatus.systemImageName)
                        .foregroundColor(verificationColor)
                        .font(.caption)
                }
            }
            .padding()
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color.white.opacity(0.05))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(
                                isLighteningAnimating ? Color.yellow.opacity(0.3) : Color.white.opacity(0.1),
                                lineWidth: 1
                            )
                    )
            )
            .scaleEffect(isHovering ? 1.02 : 1.0)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovering)
        }
        .buttonStyle(PlainButtonStyle())
        .onHover { hovering in
            isHovering = hovering
        }
    }
    
    private var verificationColor: Color {
        switch user.verificationStatus {
        case .verified: return .green
        case .pending: return .orange
        case .unverified: return .blue
        case .failed: return .red
        }
    }
}

#Preview {
    ShoutoutView()
}

