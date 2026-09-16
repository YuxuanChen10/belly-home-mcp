import AlarmKit
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            Form {
                connectionSection
                permissionSection
                syncSection
                activeAlarmsSection
            }
            .navigationTitle("Alarm Gateway")
            .disabled(model.isWorking)
            .overlay {
                if model.isWorking {
                    ProgressView()
                        .padding(18)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
    }

    private var connectionSection: some View {
        Section("Gateway") {
            TextField("http://192.168.1.20:8787", text: $model.gatewayAddress)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                .autocorrectionDisabled()

            if let credentials = model.credentials {
                LabeledContent("Device", value: credentials.name)
                LabeledContent("ID", value: String(credentials.deviceID.prefix(8)))
                Button("Unpair", role: .destructive) { model.unpair() }
            } else {
                TextField("6-digit pairing code", text: $model.pairingCode)
                    .keyboardType(.numberPad)
                TextField("Device name", text: $model.deviceName)
                Button("Pair iPhone") { Task { await model.pair() } }
                    .disabled(model.pairingCode.count != 6 || model.deviceName.isEmpty)
            }
        }
    }

    private var permissionSection: some View {
        Section("System alarm permission") {
            LabeledContent("Status", value: permissionLabel)
            if model.authorizationState != .authorized {
                Button("Grant permission") { Task { await model.requestAlarmPermission() } }
            }
        }
    }

    private var syncSection: some View {
        Section("Synchronization") {
            Button {
                Task { await model.sync() }
            } label: {
                Label("Sync now", systemImage: "arrow.trianglehead.2.clockwise.rotate.90")
            }
            .disabled(model.credentials == nil || model.authorizationState != .authorized)

            LabeledContent("Result", value: model.statusMessage)
            if let lastSync = model.lastSync {
                LabeledContent("Last sync") {
                    Text(lastSync, style: .relative)
                }
            }
        }
    }

    private var activeAlarmsSection: some View {
        Section("Active system alarms") {
            if model.activeAlarms.isEmpty {
                Text("No active AlarmKit alarms")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.activeAlarms) { alarm in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(alarm.label)
                            Spacer()
                            Text(alarm.state)
                                .foregroundStyle(.green)
                        }
                        Text(alarm.timing)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var permissionLabel: String {
        switch model.authorizationState {
        case .authorized: "Authorized"
        case .denied: "Denied"
        case .notDetermined: "Not requested"
        @unknown default: "Unknown"
        }
    }
}
