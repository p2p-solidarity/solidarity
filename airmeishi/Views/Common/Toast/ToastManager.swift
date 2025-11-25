import SwiftUI
import Combine

struct Toast: Identifiable, Equatable {
    let id = UUID()
    let title: String
    let message: String?
    let type: ToastType
    let duration: TimeInterval
    let action: (() -> Void)?
    let actionLabel: String?
    
    static func == (lhs: Toast, rhs: Toast) -> Bool {
        return lhs.id == rhs.id
    }
}

enum ToastType {
    case info
    case success
    case error
    case warning
    
    var color: Color {
        switch self {
        case .info: return .blue
        case .success: return .green
        case .error: return .red
        case .warning: return .orange
        }
    }
    
    var icon: String {
        switch self {
        case .info: return "info.circle.fill"
        case .success: return "checkmark.circle.fill"
        case .error: return "exclamationmark.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        }
    }
}

class ToastManager: ObservableObject {
    static let shared = ToastManager()
    
    @Published var currentToast: Toast?
    private var queue: [Toast] = []
    private var timer: Timer?
    
    private init() {}
    
    func show(title: String, message: String? = nil, type: ToastType = .info, duration: TimeInterval = 3.0, action: (() -> Void)? = nil, actionLabel: String? = nil) {
        let toast = Toast(title: title, message: message, type: type, duration: duration, action: action, actionLabel: actionLabel)
        
        DispatchQueue.main.async {
            if self.currentToast == nil {
                self.present(toast)
            } else {
                self.queue.append(toast)
            }
        }
    }
    
    private func present(_ toast: Toast) {
        withAnimation(.spring()) {
            currentToast = toast
        }
        
        timer?.invalidate()
        if toast.duration > 0 {
            timer = Timer.scheduledTimer(withTimeInterval: toast.duration, repeats: false) { [weak self] _ in
                self?.dismiss()
            }
        }
    }
    
    func dismiss() {
        withAnimation(.spring()) {
            currentToast = nil
        }
        
        timer?.invalidate()
        timer = nil
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self = self else { return }
            if !self.queue.isEmpty {
                let next = self.queue.removeFirst()
                self.present(next)
            }
        }
    }
}
