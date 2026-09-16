@preconcurrency import AlarmKit
import Foundation
import SwiftUI

struct GatewayAlarmMetadata: AlarmMetadata {
    let gatewayAlarmID: String
}

struct ActiveAlarmSummary: Identifiable {
    let id: UUID
    let label: String
    let timing: String
    let state: String
}

@MainActor
struct AlarmScheduler {
    private let manager = AlarmManager.shared

    func requestAuthorization() async throws -> AlarmManager.AuthorizationState {
        try await manager.requestAuthorization()
    }

    func apply(_ command: GatewayCommand) async throws {
        guard let alarmID = UUID(uuidString: command.alarmID) else {
            throw AlarmSchedulerError.invalidAlarmID
        }

        switch command.action {
        case .cancel:
            if try manager.alarms.contains(where: { $0.id == alarmID }) {
                try manager.cancel(id: alarmID)
            }
        case .upsert:
            guard let alarm = command.alarm else { throw AlarmSchedulerError.missingAlarm }
            let schedule = try makeSchedule(alarm.schedule)
            let title = LocalizedStringResource(stringLiteral: alarm.label)
            let alert: AlarmPresentation.Alert
            if #available(iOS 26.1, *) {
                alert = .init(title: title)
            } else {
                alert = .init(
                    title: title,
                    stopButton: AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.circle")
                )
            }
            let presentation = AlarmPresentation(alert: alert)
            let attributes = AlarmAttributes(
                presentation: presentation,
                metadata: GatewayAlarmMetadata(gatewayAlarmID: alarm.id),
                tintColor: .cyan
            )
            let configuration = AlarmManager.AlarmConfiguration<GatewayAlarmMetadata>.alarm(
                schedule: schedule,
                attributes: attributes
            )

            if try manager.alarms.contains(where: { $0.id == alarmID }) {
                try manager.cancel(id: alarmID)
            }
            _ = try await manager.schedule(id: alarmID, configuration: configuration)
        }
    }

    func activeAlarms(labels: [String: String]) throws -> [ActiveAlarmSummary] {
        try manager.alarms.map { alarm in
            ActiveAlarmSummary(
                id: alarm.id,
                label: labels[alarm.id.uuidString] ?? "Alarm",
                timing: timingDescription(alarm.schedule),
                state: stateDescription(alarm.state)
            )
        }
    }

    private func makeSchedule(_ gatewaySchedule: GatewaySchedule) throws -> Alarm.Schedule {
        switch gatewaySchedule {
        case .once(let fireAt):
            guard let date = Self.parseFireDate(fireAt), date > Date() else {
                throw AlarmSchedulerError.invalidFireDate
            }
            return .fixed(date)
        case .weekly(let hour, let minute, let weekdays, let timeZone):
            guard TimeZone.current.identifier == timeZone else {
                throw AlarmSchedulerError.timeZoneMismatch(requested: timeZone, current: TimeZone.current.identifier)
            }
            let recurrence = Alarm.Schedule.Relative.Recurrence.weekly(weekdays.map(\.localeWeekday))
            let time = Alarm.Schedule.Relative.Time(hour: hour, minute: minute)
            return .relative(.init(time: time, repeats: recurrence))
        }
    }

    nonisolated static func parseFireDate(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) {
            return date
        }
        return ISO8601DateFormatter().date(from: value)
    }

    private func timingDescription(_ schedule: Alarm.Schedule?) -> String {
        guard let schedule else { return "No schedule" }
        switch schedule {
        case .fixed(let date):
            return date.formatted(date: .abbreviated, time: .shortened)
        case .relative(let relative):
            let time = String(format: "%02d:%02d", relative.time.hour, relative.time.minute)
            switch relative.repeats {
            case .never:
                return time
            case .weekly:
                return "Weekly at \(time)"
            @unknown default:
                return time
            }
        @unknown default:
            return "Scheduled"
        }
    }

    private func stateDescription(_ state: Alarm.State) -> String {
        switch state {
        case .scheduled: "Scheduled"
        case .countdown: "Counting down"
        case .paused: "Paused"
        case .alerting: "Alerting"
        @unknown default: "Unknown"
        }
    }
}

private extension Weekday {
    var localeWeekday: Locale.Weekday {
        switch self {
        case .monday: .monday
        case .tuesday: .tuesday
        case .wednesday: .wednesday
        case .thursday: .thursday
        case .friday: .friday
        case .saturday: .saturday
        case .sunday: .sunday
        }
    }
}

enum AlarmSchedulerError: LocalizedError {
    case invalidAlarmID
    case missingAlarm
    case invalidFireDate
    case timeZoneMismatch(requested: String, current: String)

    var errorDescription: String? {
        switch self {
        case .invalidAlarmID: "The gateway supplied an invalid alarm identifier."
        case .missingAlarm: "The command does not contain alarm data."
        case .invalidFireDate: "The one-time alarm date is invalid or already passed."
        case .timeZoneMismatch(let requested, let current):
            "Weekly alarm requires \(requested), but the iPhone currently uses \(current)."
        }
    }
}
