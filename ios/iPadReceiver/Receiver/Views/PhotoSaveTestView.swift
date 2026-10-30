import Photos
import SwiftUI

@MainActor
struct PhotoSaveTestView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var authorization = PHPhotoLibrary.authorizationStatus(for: .addOnly)
    @State private var operation: SaveOperation = .idle
    @State private var errorMessage: String?

    private let writer = PhotoLibraryWriter()

    var body: some View {
        NavigationStack {
            Form {
                Section("Photos") {
                    LabeledContent("Permission", value: authorization.label)
                    LabeledContent("Save status", value: operation.rawValue)
                }

                Section("Test") {
                    Button("Save Test Image") {
                        Task { await saveTestImage() }
                    }
                    .disabled(operation == .saving)

                    if operation == .saving {
                        ProgressView("Saving to Photos…")
                    }
                    if let errorMessage {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .accessibilityLabel("Save failed: \(errorMessage)")
                    }
                }
            }
            .navigationTitle("Belly Receiver")
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                authorization = writer.authorizationStatus()
            }
        }
    }

    private func saveTestImage() async {
        operation = .saving
        errorMessage = nil
        defer { authorization = writer.authorizationStatus() }

        do {
            guard let fileURL = Bundle.main.url(forResource: "test-image-png", withExtension: "data") else {
                throw PhotoLibraryWriterError.invalidPNG
            }
            let data = try Data(contentsOf: fileURL)
            try await writer.savePNG(data: data, originalFilename: "test-image.png")
            operation = .success
        } catch {
            operation = .failed
            errorMessage = error.localizedDescription
        }
    }
}

private enum SaveOperation: String {
    case idle = "Idle"
    case saving = "Saving"
    case success = "Success"
    case failed = "Failed"
}

private extension PHAuthorizationStatus {
    var label: String {
        switch self {
        case .notDetermined: "Not requested"
        case .authorized: "Add Photos Only allowed"
        case .denied: "Denied"
        case .restricted: "Restricted"
        case .limited: "Limited"
        @unknown default: "Unknown"
        }
    }
}
