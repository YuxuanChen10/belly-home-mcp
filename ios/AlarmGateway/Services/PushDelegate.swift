import UIKit

@MainActor
final class PushCoordinator {
    static let shared = PushCoordinator()

    var latestToken: String?
    var onToken: ((String) -> Void)?
    var onWake: ((@escaping (UIBackgroundFetchResult) -> Void) -> Void)?

    private init() {}
}

final class PushDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        application.registerForRemoteNotifications()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        PushCoordinator.shared.latestToken = token
        PushCoordinator.shared.onToken?(token)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Manual synchronization remains available when APNs registration fails.
        print("APNs registration failed: \(error.localizedDescription)")
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        guard let onWake = PushCoordinator.shared.onWake else {
            completionHandler(.noData)
            return
        }
        onWake(completionHandler)
    }
}
