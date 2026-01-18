//
//  SimpleQRScannerView.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import AVFoundation
import SwiftUI

struct SimpleQRScannerView: View {
  var onScan: (String) -> Void
  var onCancel: () -> Void

  @State private var permissionStatus = AVCaptureDevice.authorizationStatus(for: .video)

  var body: some View {
    ZStack {
      Color.black.edgesIgnoringSafeArea(.all)

      if permissionStatus == .authorized {
        SimpleQRScannerWrapper(onScan: onScan, onCancel: onCancel)
      } else if permissionStatus == .notDetermined {
        VStack(spacing: 20) {
          ProgressView()
            .progressViewStyle(CircularProgressViewStyle(tint: .white))
            .scaleEffect(1.5)
          Text("Requesting Camera Access...")
            .foregroundColor(.white)
        }
        .onAppear {
          AVCaptureDevice.requestAccess(for: .video) { granted in
            DispatchQueue.main.async {
              permissionStatus = granted ? .authorized : .denied
            }
          }
        }
      } else {
        VStack(spacing: 20) {
          Image(systemName: "camera.fill.badge.ellipsis")
            .font(.system(size: 60))
            .foregroundColor(.gray)

          Text("Camera Access Required")
            .font(.title2)
            .fontWeight(.bold)
            .foregroundColor(.white)

          Text("Please enable camera access in Settings to scan QR codes.")
            .font(.body)
            .foregroundColor(.gray)
            .multilineTextAlignment(.center)
            .padding(.horizontal)

          Button("Open Settings") {
            if let url = URL(string: UIApplication.openSettingsURLString) {
              UIApplication.shared.open(url)
            }
          }
          .padding()
          .background(Color.blue)
          .foregroundColor(.white)
          .cornerRadius(10)

          Button("Cancel") {
            onCancel()
          }
          .padding()
          .foregroundColor(.white)
        }
      }
    }
  }
}
struct SimpleQRScannerWrapper: UIViewControllerRepresentable {
  var onScan: (String) -> Void
  var onCancel: () -> Void

  func makeUIViewController(context: Context) -> SimpleQRScannerViewController {
    let controller = SimpleQRScannerViewController()
    controller.delegate = context.coordinator
    return controller
  }

  func updateUIViewController(_ uiViewController: SimpleQRScannerViewController, context: Context) {}

  func makeCoordinator() -> Coordinator {
    Coordinator(parent: self)
  }

  class Coordinator: NSObject, SimpleQRScannerDelegate {
    let parent: SimpleQRScannerWrapper

    init(parent: SimpleQRScannerWrapper) {
      self.parent = parent
    }

    func didScan(code: String) {
      parent.onScan(code)
    }

    func didCancel() {
      parent.onCancel()
    }
  }
}

protocol SimpleQRScannerDelegate: AnyObject {
  func didScan(code: String)
  func didCancel()
}

class SimpleQRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
  weak var delegate: SimpleQRScannerDelegate?
  var captureSession: AVCaptureSession!
  var previewLayer: AVCaptureVideoPreviewLayer!

  override func viewDidLoad() {
    super.viewDidLoad()

    view.backgroundColor = UIColor.black
    captureSession = AVCaptureSession()

    guard let videoCaptureDevice = AVCaptureDevice.default(for: .video) else { return }
    let videoInput: AVCaptureDeviceInput

    do {
      videoInput = try AVCaptureDeviceInput(device: videoCaptureDevice)
    } catch {
      return
    }

    if captureSession.canAddInput(videoInput) {
      captureSession.addInput(videoInput)
    } else {
      failed()
      return
    }

    let metadataOutput = AVCaptureMetadataOutput()

    if captureSession.canAddOutput(metadataOutput) {
      captureSession.addOutput(metadataOutput)

      metadataOutput.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
      metadataOutput.metadataObjectTypes = [.qr]
    } else {
      failed()
      return
    }

    previewLayer = AVCaptureVideoPreviewLayer(session: captureSession)
    previewLayer.frame = view.layer.bounds
    previewLayer.videoGravity = .resizeAspectFill
    view.layer.addSublayer(previewLayer)

    // Add Cancel Button
    let cancelButton = UIButton(type: .system)
    cancelButton.setTitle("Cancel", for: .normal)
    cancelButton.tintColor = .white
    cancelButton.backgroundColor = UIColor.black.withAlphaComponent(0.6)
    cancelButton.layer.cornerRadius = 8
    cancelButton.translatesAutoresizingMaskIntoConstraints = false
    cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)

    view.addSubview(cancelButton)

    NSLayoutConstraint.activate([
      cancelButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
      cancelButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      cancelButton.widthAnchor.constraint(equalToConstant: 80),
      cancelButton.heightAnchor.constraint(equalToConstant: 40),
    ])

    // Add Overlay
    addOverlay()

    DispatchQueue.global(qos: .background)
      .async {
        self.captureSession.startRunning()
      }
  }

  func addOverlay() {
    let overlayView = UIView()
    overlayView.layer.borderColor = UIColor.green.cgColor
    overlayView.layer.borderWidth = 2
    overlayView.layer.cornerRadius = 12
    overlayView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(overlayView)

    NSLayoutConstraint.activate([
      overlayView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      overlayView.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      overlayView.widthAnchor.constraint(equalToConstant: 250),
      overlayView.heightAnchor.constraint(equalToConstant: 250),
    ])

    let label = UILabel()
    label.text = "Scan Group QR Code"
    label.textColor = .white
    label.font = UIFont.systemFont(ofSize: 14, weight: .medium)
    label.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(label)

    NSLayoutConstraint.activate([
      label.topAnchor.constraint(equalTo: overlayView.bottomAnchor, constant: 20),
      label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
    ])
  }

  func failed() {
    let ac = UIAlertController(
      title: "Scanning not supported",
      message: "Your device does not support scanning a code from an item. Please use a device with a camera.",
      preferredStyle: .alert
    )
    ac.addAction(UIAlertAction(title: "OK", style: .default))
    present(ac, animated: true)
    captureSession = nil
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)

    if captureSession?.isRunning == false {
      DispatchQueue.global(qos: .background)
        .async {
          self.captureSession.startRunning()
        }
    }
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)

    if captureSession?.isRunning == true {
      captureSession.stopRunning()
    }
  }

  func metadataOutput(
    _ output: AVCaptureMetadataOutput,
    didOutput metadataObjects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    captureSession.stopRunning()

    if let metadataObject = metadataObjects.first {
      guard let readableObject = metadataObject as? AVMetadataMachineReadableCodeObject else { return }
      guard let stringValue = readableObject.stringValue else { return }
      AudioServicesPlaySystemSound(SystemSoundID(kSystemSoundID_Vibrate))
      delegate?.didScan(code: stringValue)
    }
  }

  @objc func cancelTapped() {
    delegate?.didCancel()
  }

  override var prefersStatusBarHidden: Bool {
    return true
  }

  override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
    return .portrait
  }
}
