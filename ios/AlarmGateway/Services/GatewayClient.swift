import Foundation

struct GatewayClient {
    let baseURL: URL

    func pair(code: String, name: String) async throws -> DeviceCredentials {
        try await send(
            path: "/v1/devices/pair",
            method: "POST",
            token: nil,
            body: ["code": code, "name": name]
        )
    }

    func commands(credentials: DeviceCredentials, after revision: Int) async throws -> CommandInbox {
        try await send(
            path: "/v1/device/commands?after=\(revision)",
            method: "GET",
            token: credentials.deviceToken,
            body: Optional<[String: String]>.none
        )
    }

    func register(pushToken: String, credentials: DeviceCredentials) async throws {
        let _: OKResponse = try await send(
            path: "/v1/device/push-token",
            method: "POST",
            token: credentials.deviceToken,
            body: ["pushToken": pushToken]
        )
    }

    func acknowledge(
        commandID: String,
        success: Bool,
        message: String?,
        credentials: DeviceCredentials
    ) async throws {
        let payload = Acknowledgement(success: success, message: message)
        let _: AcknowledgementResponse = try await send(
            path: "/v1/device/commands/\(commandID)/ack",
            method: "POST",
            token: credentials.deviceToken,
            body: payload
        )
    }

    private func send<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        token: String?,
        body: Body?
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw GatewayClientError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw GatewayClientError.invalidResponse }
        guard 200..<300 ~= http.statusCode else {
            let envelope = try? JSONDecoder().decode(GatewayErrorEnvelope.self, from: data)
            throw GatewayClientError.server(envelope?.error.message ?? "Gateway returned HTTP \(http.statusCode)")
        }
        if Response.self == EmptyResponse.self && data.isEmpty {
            return EmptyResponse() as! Response
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}

private struct Acknowledgement: Codable {
    let success: Bool
    let message: String?
}

private struct AcknowledgementResponse: Codable {
    let command: GatewayCommand
}

private struct OKResponse: Codable {
    let ok: Bool
}

private struct EmptyResponse: Codable {}

enum GatewayClientError: LocalizedError {
    case invalidURL
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL: "The gateway URL is invalid."
        case .invalidResponse: "The gateway response is invalid."
        case .server(let message): message
        }
    }
}
