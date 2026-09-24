import AlarmKit
import Foundation
import UIKit

@MainActor
final class AppModel: ObservableObject {
    @Published var gatewayAddress: String {
        didSet { UserDefaults.standard.set(gatewayAddress, forKey: Keys.gatewayAddress) }
    }
    @Published var pairingCode = ""
    @Published var deviceName = "My iPhone"
    @Published private(set) var credentials: DeviceCredentials?
    @Published private(set) var authorizationState: AlarmManager.AuthorizationState
    @Published private(set) var isWorking = false
    @Published private(set) var statusMessage = "Ready"
    @Published private(set) var lastSync: Date?
    @Published private(set) var activeAlarms: [ActiveAlarmSummary] = []

    private let scheduler = AlarmScheduler()
    private var latestPushToken: String?
    private var lastRevision: Int {
        get { UserDefaults.standard.integer(forKey: Keys.lastRevision) }
        set { UserDefaults.standard.set(newValue, forKey: Keys.lastRevision) }
    }

    init() {
        let migratedAddress = GatewayClient.migratedAddress(UserDefaults.standard.string(forKey: Keys.gatewayAddress))
        gatewayAddress = migratedAddress
        UserDefaults.standard.set(migratedAddress, forKey: Keys.gatewayAddress)
        credentials = CredentialStore.load()
        authorizationState = AlarmManager.shared.authorizationState
        configurePushEvents()
        refreshActiveAlarms()
    }

    func requestAlarmPermission() async {
        await perform {
            self.authorizationState = try await self.scheduler.requestAuthorization()
            self.statusMessage = self.authorizationState == .authorized ? "Alarm permission granted" : "Alarm permission was not granted"
        }
    }

    func pair() async {
        await perform {
            let client = try self.client()
            let value = try await client.pair(code: self.pairingCode.trimmingCharacters(in: .whitespaces), name: self.deviceName)
            try CredentialStore.save(value)
            self.credentials = value
            self.lastRevision = 0
            self.pairingCode = ""
            self.statusMessage = "Paired as \(value.name)"
            if let pushToken = self.latestPushToken {
                try await client.register(pushToken: pushToken, credentials: value)
            }
        }
    }

    func unpair() {
        CredentialStore.clear()
        credentials = nil
        lastRevision = 0
        statusMessage = "Device unpaired"
    }

    func sync() async {
        await perform {
            guard let credentials = self.credentials else { throw AppModelError.notPaired }
            guard self.authorizationState == .authorized else { throw AppModelError.alarmPermissionRequired }
            let client = try self.client()
            let inbox = try await client.commands(credentials: credentials, after: self.lastRevision)
            var applied = 0
            var succeeded = 0
            var failures: [String] = []
            for command in inbox.commands.sorted(by: { $0.revision < $1.revision }) {
                do {
                    try await self.scheduler.apply(command)
                    try await client.acknowledge(commandID: command.id, success: true, message: nil, credentials: credentials)
                    self.remember(command)
                    succeeded += 1
                } catch {
                    try await client.acknowledge(
                        commandID: command.id,
                        success: false,
                        message: error.localizedDescription,
                        credentials: credentials
                    )
                    failures.append(error.localizedDescription)
                }
                self.lastRevision = max(self.lastRevision, command.revision)
                applied += 1
            }
            self.lastRevision = max(self.lastRevision, inbox.latestRevision)
            self.lastSync = Date()
            self.refreshActiveAlarms()
            if applied == 0 {
                self.statusMessage = "No pending alarm changes"
            } else if failures.isEmpty {
                self.statusMessage = "Confirmed \(succeeded) alarm change\(succeeded == 1 ? "" : "s")"
            } else {
                self.statusMessage = "Failed: \(failures.joined(separator: "; "))"
            }
        }
    }

    private func remember(_ command: GatewayCommand) {
        var labels = alarmLabels
        switch command.action {
        case .upsert:
            if let alarm = command.alarm {
                labels[alarm.id] = alarm.label
            }
        case .cancel:
            labels.removeValue(forKey: command.alarmID)
        }
        alarmLabels = labels
    }

    private func refreshActiveAlarms() {
        activeAlarms = (try? scheduler.activeAlarms(labels: alarmLabels)) ?? []
    }

    private var alarmLabels: [String: String] {
        get {
            guard let data = UserDefaults.standard.data(forKey: Keys.alarmLabels) else { return [:] }
            return (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
        }
        set {
            UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: Keys.alarmLabels)
        }
    }

    private func client() throws -> GatewayClient {
        GatewayClient(baseURL: try GatewayClient.resolveBaseURL(gatewayAddress))
    }

    private func configurePushEvents() {
        latestPushToken = PushCoordinator.shared.latestToken
        PushCoordinator.shared.onToken = { [weak self] token in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.latestPushToken = token
                guard let credentials = self.credentials, let client = try? self.client() else { return }
                try? await client.register(pushToken: token, credentials: credentials)
            }
        }
        PushCoordinator.shared.onWake = { [weak self] completion in
            Task { @MainActor [weak self] in
                await self?.sync()
                completion(.newData)
            }
        }
    }

    private func perform(_ operation: () async throws -> Void) async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            try await operation()
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    private enum Keys {
        static let gatewayAddress = "gatewayAddress"
        static let lastRevision = "lastRevision"
        static let alarmLabels = "alarmLabels"
    }
}

enum AppModelError: LocalizedError {
    case notPaired
    case alarmPermissionRequired

    var errorDescription: String? {
        switch self {
        case .notPaired: "Pair this iPhone with the gateway first."
        case .alarmPermissionRequired: "Grant alarm permission before synchronizing."
        }
    }
}
