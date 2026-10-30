import Foundation
import Photos

enum PhotoLibraryWriterError: LocalizedError {
    case permissionDenied
    case permissionRestricted
    case permissionUnavailable
    case invalidPNG
    case saveFailed

    var errorDescription: String? {
        switch self {
        case .permissionDenied:
            "Photos access was denied. Allow Add Photos Only in Settings, then try again."
        case .permissionRestricted:
            "Photos access is restricted on this iPad. Check device or family restrictions."
        case .permissionUnavailable:
            "Photos authorization is unavailable. Please try again."
        case .invalidPNG:
            "The bundled test image is missing or is not a valid PNG."
        case .saveFailed:
            "Photos did not confirm that the image was saved. Please try again."
        }
    }
}

struct PhotoLibraryWriter {
    func authorizationStatus() -> PHAuthorizationStatus {
        PHPhotoLibrary.authorizationStatus(for: .addOnly)
    }

    func savePNG(data: Data, originalFilename: String = "image.png") async throws {
        let signature = Data([137, 80, 78, 71, 13, 10, 26, 10])
        guard data.starts(with: signature) else {
            throw PhotoLibraryWriterError.invalidPNG
        }

        let status = authorizationStatus() == .notDetermined
            ? await requestAddOnlyAuthorization()
            : authorizationStatus()
        switch status {
        case .authorized, .limited:
            break
        case .denied:
            throw PhotoLibraryWriterError.permissionDenied
        case .restricted:
            throw PhotoLibraryWriterError.permissionRestricted
        case .notDetermined:
            throw PhotoLibraryWriterError.permissionUnavailable
        @unknown default:
            throw PhotoLibraryWriterError.permissionUnavailable
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            PHPhotoLibrary.shared().performChanges {
                let request = PHAssetCreationRequest.forAsset()
                let options = PHAssetResourceCreationOptions()
                options.originalFilename = originalFilename
                request.addResource(with: .photo, data: data, options: options)
            } completionHandler: { success, error in
                if success {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: error ?? PhotoLibraryWriterError.saveFailed)
                }
            }
        }
    }

    private func requestAddOnlyAuthorization() async -> PHAuthorizationStatus {
        await withCheckedContinuation { continuation in
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                continuation.resume(returning: status)
            }
        }
    }
}
