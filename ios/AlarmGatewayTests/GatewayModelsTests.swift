import XCTest
@testable import AlarmGateway

final class GatewayModelsTests: XCTestCase {
    func testDecodesWeeklySchedule() throws {
        let data = Data(#"{"kind":"weekly","hour":7,"minute":30,"weekdays":["monday","friday"],"timeZone":"Australia/Melbourne"}"#.utf8)
        let schedule = try JSONDecoder().decode(GatewaySchedule.self, from: data)
        XCTAssertEqual(schedule, .weekly(hour: 7, minute: 30, weekdays: [.monday, .friday], timeZone: "Australia/Melbourne"))
    }

    func testDecodesOneTimeSchedule() throws {
        let data = Data(#"{"kind":"once","fireAt":"2026-09-16T07:30:00+10:00"}"#.utf8)
        let schedule = try JSONDecoder().decode(GatewaySchedule.self, from: data)
        XCTAssertEqual(schedule, .once(fireAt: "2026-09-16T07:30:00+10:00"))
    }

    func testParsesGatewayTimestampWithMilliseconds() {
        let date = AlarmScheduler.parseFireDate("2026-09-15T10:02:32.400Z")
        XCTAssertNotNil(date)
    }

    func testParsesGatewayTimestampWithoutMilliseconds() {
        let date = AlarmScheduler.parseFireDate("2026-09-15T10:02:32Z")
        XCTAssertNotNil(date)
    }

    func testMigratesLoopbackGatewayAddressToPublicEndpoint() {
        XCTAssertEqual(
            GatewayClient.migratedAddress("http://127.0.0.1:8787"),
            GatewayClient.productionAddress
        )
        XCTAssertEqual(
            GatewayClient.migratedAddress("http://localhost:8787"),
            GatewayClient.productionAddress
        )
    }

    func testKeepsUserConfiguredGatewayAddress() {
        XCTAssertEqual(
            GatewayClient.migratedAddress("http://192.168.1.20:8787"),
            "http://192.168.1.20:8787"
        )
    }

    func testNormalizesPublicGatewayAndPluginEndpoint() throws {
        XCTAssertEqual(
            try GatewayClient.resolveBaseURL("alarm.bellyjuris.com").absoluteString,
            "https://alarm.bellyjuris.com"
        )
        XCTAssertEqual(
            try GatewayClient.resolveBaseURL("https://alarm.bellyjuris.com/mcp").absoluteString,
            "https://alarm.bellyjuris.com"
        )
    }

    func testRejectsGatewayAddressWithUnexpectedPath() {
        XCTAssertThrowsError(try GatewayClient.resolveBaseURL("https://alarm.bellyjuris.com/not-gateway"))
    }
}
