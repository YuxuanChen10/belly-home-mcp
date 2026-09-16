import Foundation

struct DeviceCredentials: Codable, Equatable {
    let deviceID: String
    let deviceToken: String
    let name: String

    enum CodingKeys: String, CodingKey {
        case deviceID = "deviceId"
        case deviceToken
        case name
    }
}

enum GatewaySchedule: Codable, Equatable {
    case once(fireAt: String)
    case weekly(hour: Int, minute: Int, weekdays: [Weekday], timeZone: String)

    private enum CodingKeys: String, CodingKey {
        case kind, fireAt, hour, minute, weekdays, timeZone
    }

    private enum Kind: String, Codable {
        case once, weekly
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        switch try values.decode(Kind.self, forKey: .kind) {
        case .once:
            self = .once(fireAt: try values.decode(String.self, forKey: .fireAt))
        case .weekly:
            self = .weekly(
                hour: try values.decode(Int.self, forKey: .hour),
                minute: try values.decode(Int.self, forKey: .minute),
                weekdays: try values.decode([Weekday].self, forKey: .weekdays),
                timeZone: try values.decode(String.self, forKey: .timeZone)
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .once(let fireAt):
            try values.encode(Kind.once, forKey: .kind)
            try values.encode(fireAt, forKey: .fireAt)
        case .weekly(let hour, let minute, let weekdays, let timeZone):
            try values.encode(Kind.weekly, forKey: .kind)
            try values.encode(hour, forKey: .hour)
            try values.encode(minute, forKey: .minute)
            try values.encode(weekdays, forKey: .weekdays)
            try values.encode(timeZone, forKey: .timeZone)
        }
    }
}

enum Weekday: String, Codable, CaseIterable {
    case monday, tuesday, wednesday, thursday, friday, saturday, sunday
}

struct GatewayAlarm: Codable, Equatable, Identifiable {
    let id: String
    let label: String
    let schedule: GatewaySchedule
}

struct GatewayCommand: Codable, Identifiable {
    enum Action: String, Codable {
        case upsert, cancel
    }

    let id: String
    let revision: Int
    let action: Action
    let alarmID: String
    let alarm: GatewayAlarm?

    enum CodingKeys: String, CodingKey {
        case id, revision, action, alarm
        case alarmID = "alarmId"
    }
}

struct CommandInbox: Codable {
    let commands: [GatewayCommand]
    let latestRevision: Int
}

struct GatewayErrorEnvelope: Codable {
    struct Payload: Codable {
        let code: String
        let message: String
    }

    let error: Payload
}
