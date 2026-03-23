import ContactsUI
import SwiftUI

struct ContactPickerView: UIViewControllerRepresentable {
  let onPick: ([CNContact]) -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(onPick: onPick)
  }

  func makeUIViewController(context: Context) -> CNContactPickerViewController {
    let picker = CNContactPickerViewController()
    picker.delegate = context.coordinator
    return picker
  }

  func updateUIViewController(_ uiViewController: CNContactPickerViewController, context: Context) {}

  final class Coordinator: NSObject, CNContactPickerDelegate {
    let onPick: ([CNContact]) -> Void

    init(onPick: @escaping ([CNContact]) -> Void) {
      self.onPick = onPick
    }

    func contactPicker(_ picker: CNContactPickerViewController, didSelect contacts: [CNContact]) {
      onPick(contacts)
    }

    func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
      // no-op
    }
  }
}
