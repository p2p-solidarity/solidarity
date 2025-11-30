//
//  WebRTCManager.swift
//  airmeishi
//
//  Manages WebRTC connections and data channels for peer-to-peer messaging.
//

import Foundation
import WebRTC
import Combine
import MultipeerConnectivity

// MARK: - Models

struct WebRTCMessage: Codable {
    let type: String // "sakura" or "text"
    let content: String
    let timestamp: Date
}

enum SignalingMessage: Codable {
    case sdp(SessionDescription)
    case candidate(IceCandidate)
}

struct SessionDescription: Codable {
    let sdp: String
    let type: String // "offer", "answer", "pranswer", "rollback"
    
    var rtcSdpType: RTCSdpType {
        switch type {
        case "offer": return .offer
        case "answer": return .answer
        case "pranswer": return .prAnswer
        default: return .offer
        }
    }
}

struct IceCandidate: Codable {
    let sdp: String
    let sdpMLineIndex: Int32
    let sdpMid: String?
}

// MARK: - WebRTCManager

class WebRTCManager: NSObject, ObservableObject {
    static let shared = WebRTCManager()
    
    @Published var latestMessage: WebRTCMessage?
    @Published var connectionState: RTCIceConnectionState = .new
    @Published var isChannelOpen: Bool = false
    @Published var remotePeerID: MCPeerID?
    
    private let factory: RTCPeerConnectionFactory
    private var peerConnection: RTCPeerConnection?
    private var dataChannel: RTCDataChannel?
    
    // Signaling callback: (SignalingMessage) -> Void
    var onSendSignalingMessage: ((SignalingMessage) -> Void)?
    
    private let rtcConfig: RTCConfiguration = {
        let config = RTCConfiguration()
        config.iceServers = [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])]
        config.sdpSemantics = .unifiedPlan
        return config
    }()
    
    private let mediaConstraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
    
    override init() {
        print("[WebRTC] Initializing WebRTCManager")
        RTCInitializeSSL()
        let videoEncoderFactory = RTCDefaultVideoEncoderFactory()
        let videoDecoderFactory = RTCDefaultVideoDecoderFactory()
        self.factory = RTCPeerConnectionFactory(encoderFactory: videoEncoderFactory, decoderFactory: videoDecoderFactory)
        super.init()
        print("[WebRTC] WebRTCManager initialized successfully")
    }
    
    // MARK: - Public API
    
    func setupConnection(for peerID: MCPeerID) {
        print("[WebRTC] Setting up new peer connection for \(peerID.displayName)")
        close()
        
        // Update @Published property on main thread
        DispatchQueue.main.async {
            self.remotePeerID = peerID
        }
        
        let pc = factory.peerConnection(with: rtcConfig, constraints: mediaConstraints, delegate: self)
        self.peerConnection = pc
        print("[WebRTC] Peer connection created")
        
        // Create Data Channel (for the initiator)
        // Note: In a perfect world we'd negotiate who is initiator. 
        // For simplicity, we might rely on the caller calling `offer()` to create the channel.
    }
    
    func offer() {
        guard let pc = peerConnection else {
            print("[WebRTC] Cannot create offer: peer connection is nil")
            return
        }
        
        print("[WebRTC] Creating offer and data channel")
        // Create Data Channel
        let config = RTCDataChannelConfiguration()
        config.isOrdered = true
        self.dataChannel = pc.dataChannel(forLabel: "airmeishi-data", configuration: config)
        self.dataChannel?.delegate = self
        print("[WebRTC] Data channel created with label: airmeishi-data")
        // Note: delegate method dataChannelDidChangeState will update isChannelOpen
        
        pc.offer(for: mediaConstraints) { [weak self] sdp, error in
            guard let self = self else { return }
            if let error = error {
                print("[WebRTC] Failed to create offer: \(error)")
                return
            }
            guard let sdp = sdp else {
                print("[WebRTC] Offer created but SDP is nil")
                return
            }
            print("[WebRTC] Offer created successfully, setting local description")
            pc.setLocalDescription(sdp) { error in
                if let error = error {
                    print("[WebRTC] Set local description error: \(error)")
                    return
                }
                print("[WebRTC] Local description set, sending offer SDP")
                self.sendSignalingMessage(.sdp(SessionDescription(sdp: sdp.sdp, type: self.string(from: sdp.type))))
            }
        }
    }
    
    func answer() {
        guard let pc = peerConnection else {
            print("[WebRTC] Cannot create answer: peer connection is nil")
            return
        }
        
        print("[WebRTC] Creating answer")
        pc.answer(for: mediaConstraints) { [weak self] sdp, error in
            guard let self = self else { return }
            if let error = error {
                print("[WebRTC] Failed to create answer: \(error)")
                return
            }
            guard let sdp = sdp else {
                print("[WebRTC] Answer created but SDP is nil")
                return
            }
            print("[WebRTC] Answer created successfully, setting local description")
            pc.setLocalDescription(sdp) { error in
                if let error = error {
                    print("[WebRTC] Set local description error: \(error)")
                    return
                }
                print("[WebRTC] Local description set, sending answer SDP")
                self.sendSignalingMessage(.sdp(SessionDescription(sdp: sdp.sdp, type: self.string(from: sdp.type))))
            }
        }
    }
    
    func handleSignalingMessage(_ message: SignalingMessage, from peerID: MCPeerID) {
        if peerConnection == nil {
            print("[WebRTC] Peer connection is nil, setting up new connection for \(peerID.displayName)")
            DispatchQueue.main.async {
                self.setupConnection(for: peerID)
            }
        }
        // Verify this message is from the current WebRTC peer
        guard let currentRemote = remotePeerID, currentRemote == peerID else {
            print("[WebRTC] Ignoring signaling message from \(peerID.displayName) (current remote: \(remotePeerID?.displayName ?? "nil"))")
            return
        }
        guard let pc = peerConnection else {
            print("[WebRTC] Cannot handle signaling message: peer connection is nil")
            return
        }
        
        switch message {
        case .sdp(let sessionDescription):
            print("[WebRTC] Received SDP message, type: \(sessionDescription.type)")
            let sdp = RTCSessionDescription(type: sessionDescription.rtcSdpType, sdp: sessionDescription.sdp)
            pc.setRemoteDescription(sdp) { [weak self] error in
                if let error = error {
                    print("[WebRTC] Set remote description error: \(error)")
                    return
                }
                print("[WebRTC] Remote description set successfully")
                
                if sdp.type == .offer {
                    print("[WebRTC] Received offer, creating answer")
                    self?.answer()
                }
            }
            
        case .candidate(let iceCandidate):
            print("[WebRTC] Received ICE candidate (sdpMid: \(iceCandidate.sdpMid ?? "nil"), sdpMLineIndex: \(iceCandidate.sdpMLineIndex))")
            let candidate = RTCIceCandidate(sdp: iceCandidate.sdp, sdpMLineIndex: iceCandidate.sdpMLineIndex, sdpMid: iceCandidate.sdpMid)
            pc.add(candidate) { error in
                if let error = error {
                    print("[WebRTC] Failed to add candidate: \(error)")
                } else {
                    print("[WebRTC] ICE candidate added successfully")
                }
            }
        }
    }
    
    func sendSakura() {
        print("[WebRTC] Sending sakura message")
        let message = WebRTCMessage(type: "sakura", content: "🌸", timestamp: Date())
        sendData(message)
    }
    
    func sendText(_ text: String) {
        print("[WebRTC] Sending text message: \(text.prefix(50))")
        let message = WebRTCMessage(type: "text", content: text, timestamp: Date())
        sendData(message)
    }
    
    func close() {
        print("[WebRTC] Closing connection and cleaning up")
        dataChannel?.close()
        dataChannel = nil
        peerConnection?.close()
        peerConnection = nil
        DispatchQueue.main.async {
            self.isChannelOpen = false
            self.remotePeerID = nil
        }
        print("[WebRTC] Connection closed")
    }
    
    // MARK: - Private Helpers
    
    private func sendSignalingMessage(_ message: SignalingMessage) {
        switch message {
        case .sdp(let sessionDescription):
            print("[WebRTC] Sending signaling message: SDP (\(sessionDescription.type))")
        case .candidate(let iceCandidate):
            print("[WebRTC] Sending signaling message: ICE candidate (sdpMid: \(iceCandidate.sdpMid ?? "nil"))")
        }
        onSendSignalingMessage?(message)
    }
    
    private func sendData(_ message: WebRTCMessage) {
        guard let dataChannel = dataChannel, dataChannel.readyState == .open else {
            print("[WebRTC] Cannot send data: data channel not open (state: \(dataChannel?.readyState.rawValue ?? -1))")
            return
        }
        
        do {
            let data = try JSONEncoder().encode(message)
            let buffer = RTCDataBuffer(data: data, isBinary: true)
            let success = dataChannel.sendData(buffer)
            if success {
                print("[WebRTC] Message sent successfully (type: \(message.type), size: \(data.count) bytes)")
            } else {
                print("[WebRTC] Failed to send message: sendData returned false")
            }
            
            // Also update local UI for sent messages if needed, or just for "latest message" logic
            DispatchQueue.main.async {
                self.latestMessage = message
            }
        } catch {
            print("[WebRTC] Failed to encode message: \(error)")
        }
    }
    
    private func string(from type: RTCSdpType) -> String {
        switch type {
        case .offer: return "offer"
        case .answer: return "answer"
        case .prAnswer: return "pranswer"
        case .rollback: return "rollback"
        @unknown default: return "offer"
        }
    }
    
    private func string(from state: RTCSignalingState) -> String {
        switch state {
        case .stable: return "stable"
        case .haveLocalOffer: return "haveLocalOffer"
        case .haveLocalPrAnswer: return "haveLocalPrAnswer"
        case .haveRemoteOffer: return "haveRemoteOffer"
        case .haveRemotePrAnswer: return "haveRemotePrAnswer"
        case .closed: return "closed"
        @unknown default: return "unknown"
        }
    }
    
    private func string(from state: RTCIceConnectionState) -> String {
        switch state {
        case .new: return "new"
        case .checking: return "checking"
        case .connected: return "connected"
        case .completed: return "completed"
        case .failed: return "failed"
        case .disconnected: return "disconnected"
        case .closed: return "closed"
        case .count: return "count"
        @unknown default: return "unknown"
        }
    }
    
    private func string(from state: RTCIceGatheringState) -> String {
        switch state {
        case .new: return "new"
        case .gathering: return "gathering"
        case .complete: return "complete"
        @unknown default: return "unknown"
        }
    }
    
    private func string(from state: RTCDataChannelState) -> String {
        switch state {
        case .connecting: return "connecting"
        case .open: return "open"
        case .closing: return "closing"
        case .closed: return "closed"
        @unknown default: return "unknown"
        }
    }
}

// MARK: - RTCPeerConnectionDelegate

extension WebRTCManager: RTCPeerConnectionDelegate {
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {
        let stateString = string(from: stateChanged)
        print("[WebRTC] Signaling state changed: \(stateString)")
    }
    
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {
        print("[WebRTC] Media stream added (streamId: \(stream.streamId))")
    }
    
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {
        print("[WebRTC] Media stream removed (streamId: \(stream.streamId))")
    }
    
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {
        print("[WebRTC] Peer connection should negotiate")
    }
    
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        let stateString = string(from: newState)
        print("[WebRTC] ICE connection state changed: \(stateString)")
        DispatchQueue.main.async {
            self.connectionState = newState
        }
    }
    
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {
        let stateString = string(from: newState)
        print("[WebRTC] ICE gathering state changed: \(stateString)")
    }
    
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        print("[WebRTC] ICE candidate generated (sdpMid: \(candidate.sdpMid ?? "nil"), sdpMLineIndex: \(candidate.sdpMLineIndex))")
        let iceCandidate = IceCandidate(sdp: candidate.sdp, sdpMLineIndex: candidate.sdpMLineIndex, sdpMid: candidate.sdpMid)
        sendSignalingMessage(.candidate(iceCandidate))
    }
    
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {
        print("[WebRTC] ICE candidates removed: \(candidates.count) candidates")
    }
    
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
        print("[WebRTC] Data channel received from remote (label: \(dataChannel.label))")
        self.dataChannel = dataChannel
        self.dataChannel?.delegate = self
        DispatchQueue.main.async { self.isChannelOpen = true }
    }
}

// MARK: - RTCDataChannelDelegate

extension WebRTCManager: RTCDataChannelDelegate {
    func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        let stateString = string(from: dataChannel.readyState)
        print("[WebRTC] Data channel state changed: \(stateString) (label: \(dataChannel.label))")
        DispatchQueue.main.async {
            self.isChannelOpen = dataChannel.readyState == .open
        }
    }
    
    func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        print("[WebRTC] Received data message (size: \(buffer.data.count) bytes, isBinary: \(buffer.isBinary))")
        do {
            let message = try JSONDecoder().decode(WebRTCMessage.self, from: buffer.data)
            DispatchQueue.main.async {
                self.latestMessage = message
                print("[WebRTC] Message decoded successfully (type: \(message.type), content: \(message.content))")
            }
        } catch {
            print("[WebRTC] Failed to decode received message: \(error)")
        }
    }
}
