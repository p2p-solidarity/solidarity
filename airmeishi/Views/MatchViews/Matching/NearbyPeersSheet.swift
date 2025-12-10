//
//  NearbyPeersSheet.swift
//  airmeishi
//
//  Sheet listing nearby peers with search and a CTA to view latest card.
//

import SwiftUI

struct NearbyPeersSheet: View {
    let peers: [ProximityPeer]
    let connectedCount: Int
    let onViewLatestCard: () -> Void
    let onSendInvitation: (ProximityPeer) -> Void
    let onHandleViewLatestCard: () -> Void
    
    @Environment(\.dismiss) private var dismiss
    @State private var isLighteningAnimating = false
    @State private var searchText = ""
    @State private var selectedPeer: ProximityPeer?
    @State private var showingPeerDetail = false
    @State private var showingConnectPopup = false
    @State private var connectTarget: ProximityPeer?
    @StateObject private var proximityManager = ProximityManager.shared
    @StateObject private var cardManager = CardManager.shared
    
    var filteredPeers: [ProximityPeer] {
        if searchText.isEmpty { return peers }
        return peers.filter { peer in
            peer.cardName?.localizedCaseInsensitiveContains(searchText) == true ||
            peer.cardTitle?.localizedCaseInsensitiveContains(searchText) == true ||
            peer.cardCompany?.localizedCaseInsensitiveContains(searchText) == true ||
            peer.name.localizedCaseInsensitiveContains(searchText) == true
        }
    }
    
    var body: some View {
        NavigationView {
            ZStack {
                LinearGradient(
                    colors: [Color.black, Color.blue.opacity(0.1), Color.purple.opacity(0.05), Color.black],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ).ignoresSafeArea()
                
                VStack(spacing: 0) {
                    lightningHeader
                    searchBar
                    if filteredPeers.isEmpty && !searchText.isEmpty {
                        emptySearchState
                    } else if filteredPeers.isEmpty {
                        emptyState
                    } else {
                        peersGrid
                    }
                    if connectedCount > 0 { lightningActionButton }
                    
                    // Soft status message
                    if let message = proximityManager.matchingInfoMessage {
                        Text(message)
                            .font(.footnote)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                            .padding(.bottom, 8)
                            .transition(.opacity)
                    }
                }

                if let target = connectTarget, showingConnectPopup {
                    ConnectPeerPopupView(peer: target, isPresented: $showingConnectPopup, autoDismissOnSuccess: true) {
                        connectTarget = nil
                    }
                    .transition(.opacity)
                }
            }
            .navigationTitle("Lightening Peers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button("Done") { dismiss() } } }
            .onAppear { isLighteningAnimating = true }
            .sheet(isPresented: $showingPeerDetail) {
                if let peer = selectedPeer { PeerDetailSheet(peer: peer) }
            }
        }
        .preferredColorScheme(.dark)
    }
    
    private var lightningHeader: some View {
        VStack(spacing: 16) {
            HStack {
                Image(systemName: "bolt.fill").foregroundColor(.yellow).font(.title)
                    .scaleEffect(isLighteningAnimating ? 1.3 : 1.0)
                    .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: isLighteningAnimating)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Lightening Peers").font(.title2).fontWeight(.bold).foregroundColor(.white)
                    Text("\(peers.count) nearby connections").font(.caption).foregroundColor(.gray)
                }
                Spacer()
                HStack(spacing: 8) {
                    Circle().fill(connectedCount > 0 ? .green : .orange).frame(width: 8, height: 8)
                        .scaleEffect(isLighteningAnimating ? 1.3 : 1.0)
                        .animation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true), value: isLighteningAnimating)
                    Text("\(connectedCount) connected").font(.caption).foregroundColor(.gray)
                }
            }.padding(.horizontal)
        }.padding(.vertical)
    }
    
    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass").foregroundColor(.yellow)
            TextField("Search peers...", text: $searchText)
                .textFieldStyle(PlainTextFieldStyle()).foregroundColor(.white)
            if !searchText.isEmpty {
                Button("Clear") { searchText = "" }.font(.caption).foregroundColor(.gray)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.white.opacity(0.08))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.yellow.opacity(0.3), lineWidth: 1))
        )
        .padding(.horizontal)
    }
    
    private var peersGrid: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)], spacing: 16) {
                ForEach(filteredPeers) { peer in
                    LighteningPeerCard(peer: peer, isLighteningAnimating: isLighteningAnimating, onTap: {
                        selectedPeer = peer
                        showingPeerDetail = true
                    }, onConnect: {
                        connectTarget = peer
                        showingConnectPopup = true
                    })
                }
            }
            .padding()
            .padding(.bottom, connectedCount > 0 ? 100 : 20)
        }
    }
    
    private var emptyState: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle().stroke(Color.white.opacity(0.1), lineWidth: 2).frame(width: 120, height: 120)
                    .scaleEffect(isLighteningAnimating ? 1.1 : 1.0)
                    .animation(.easeInOut(duration: 2.0).repeatForever(autoreverses: true), value: isLighteningAnimating)
                Image(systemName: "person.2.fill").font(.system(size: 40)).foregroundColor(.gray)
            }
            VStack(spacing: 8) {
                Text("No Lightening Peers Yet").font(.title2).fontWeight(.bold).foregroundColor(.white)
                Text("Start matching to discover nearby professionals with lightning-fast connections")
                    .font(.body).foregroundColor(.gray).multilineTextAlignment(.center).padding(.horizontal, 32)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    
    private var emptySearchState: some View {
        VStack(spacing: 20) {
            Image(systemName: "magnifyingglass").font(.system(size: 40)).foregroundColor(.gray)
            VStack(spacing: 8) {
                Text("No Results").font(.title2).fontWeight(.bold).foregroundColor(.white)
                Text("No peers match your search").font(.body).foregroundColor(.gray)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    
    private var lightningActionButton: some View {
        VStack {
            Spacer()
            Button(action: onViewLatestCard) {
                HStack(spacing: 12) {
                    Image(systemName: "bolt.fill").font(.title2)
                        .scaleEffect(isLighteningAnimating ? 1.3 : 1.0)
                        .animation(.easeInOut(duration: 0.3).repeatForever(autoreverses: true), value: isLighteningAnimating)
                    Text("View Latest Lightening Card").font(.headline).fontWeight(.bold)
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(LinearGradient(colors: [.yellow, .orange, .red], startPoint: .leading, endPoint: .trailing))
                        .shadow(color: .yellow.opacity(0.5), radius: 10, x: 0, y: 0)
                )
            }
            .padding(.horizontal)
            .padding(.bottom, 20)
        }
    }
}


