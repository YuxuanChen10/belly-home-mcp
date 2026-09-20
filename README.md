# Belly Home MCP

This private local project connects natural-language requests to two home modules:

- Alarm: create app-owned iPhone alarms through the existing Alarm Gateway and iOS app.
- Diary: append, read, and list private Markdown diary entries through the same MCP boundary.

## What is included

- `gateway/`: one persistent HTTP service for the Gateway API and MCP. The create-only MCP exposes alarm creation plus document tools.
- `gateway/src/gateway/`: transport, dependency composition, and tool registration for the single `belly-home-mcp` server.
- `gateway/src/modules/`: business-domain implementations. Memory owns Diary/Documents, Automation owns Alarm, and Desktop is an intentionally empty future boundary.
- `gateway/src/common/`: small cross-domain primitives only.
- `gateway/src/mcp-create-server.mjs`: least-privilege stdio MCP server exposing one-time alarm creation plus private Markdown diary tools.
- `gateway/src/server.mjs`: the unified Gateway and Streamable HTTP MCP service.
- `ios/`: SwiftUI iPhone client that pairs with the gateway, synchronizes commands, schedules AlarmKit alarms, and acknowledges results.
- `skill/alarm-gateway/`: Codex skill that defines safe alarm behavior and the MCP tool contract.
- `launchd/`: one LaunchAgent plist for keeping Belly Home online after login.
- `MCP_SETUP.zh-CN.md`, `RUNBOOK.zh-CN.md`, `SECURITY.zh-CN.md`, `ROADMAP.zh-CN.md`: v0.2 operating documentation.
- `ARCHITECTURE.md`: the domain-oriented architecture decision and evolution rules.

The gateway distinguishes `queued` from `scheduled`. A request is only `scheduled` after the phone acknowledges that AlarmKit accepted it.

## Local acceptance test

Requirements: Node.js 22 or newer.

```bash
cd gateway
npm install
cp .env.example .env
npm test
npm start
```

In a second terminal:

```bash
cd gateway
npm run demo
```

The demo pairs a simulated phone, creates an alarm, fetches the device command, acknowledges it, and verifies the final `scheduled` state.

The MCP end-to-end test covers the v0.2 alarm + diary tool boundary:

```bash
cd gateway
npm run e2e:mcp -- "MCP test" 5
```

## iPhone acceptance test

Requirements: iPhone on iOS 26, Xcode 26, and XcodeGen.

```bash
cd ios
xcodegen generate
open AlarmGateway.xcodeproj
```

In Xcode, select your development team, change the bundle identifier if needed, and run on the iPhone. Enter the Mac-reachable gateway URL, create a pairing code with `npm run pairing-code`, and pair the phone. Grant AlarmKit permission, then use **Sync now** after creating an alarm through the API or MCP tool.

For a physical phone, the gateway URL cannot be `localhost`; use the Mac's LAN address, for example `http://192.168.1.20:8787`. Foreground synchronization is always available for deterministic local testing. When APNs credentials are configured, the gateway also sends a background wake-up after each queued change; iOS still decides when background work runs, so queued status remains truthful until the phone ACK arrives.

## MCP configuration

For the final least-privilege integration, start the gateway first and register this command as a local MCP server:

```bash
node --env-file=/absolute/path/to/gateway/.env /absolute/path/to/gateway/src/mcp-create-server.mjs
```

It exposes `create_alarm`, `append_diary`, `update_diary`, `read_diary`, `list_diary_entries`, `append_document`, and `read_document`. The configured phone ID is never accepted from the MCP caller, and the MCP process uses `ALARM_PLUGIN_TOKEN`, which is accepted only by the create-only Gateway route. Diary is the private life domain: its tools use the server's `Australia/Melbourne` date, maintain stable entry IDs, and preserve update history. Document is the shareable knowledge domain: `append_document` and `read_document` accept only `design`, `development`, or `knowledge`, support Unicode character pagination for reads, and never accept a file path. Diary is never exposed through a Document target.

For Streamable HTTP, run the unified service:

```bash
cd gateway
npm start
```

Then connect to `http://127.0.0.1:8787/mcp`. The Gateway API, MCP, and tunnel origin all use `BELLY_HOME_PORT`. See `gateway/mcp-create.example.json`, `gateway/mcp-http.example.json`, and `MCP_SETUP.zh-CN.md` for complete setup.

Relevant environment variables:

- `BELLY_HOME_PORT`, the single port used by Gateway, MCP, and the tunnel origin; default `8787`
- `ALARM_PLUGIN_TOKEN`, required by the create-only MCP server
- `ALARM_DEVICE_ID`, fixed server-side target configured on the Gateway
- `ALARM_TIMEZONE`, default `Australia/Melbourne`
- `DIARY_ROOT_DIR`, default `~/Library/Application Support/Belly Home Infra/Diary`
- `DIARY_LOG_FILE`, default `~/Library/Logs/Belly Home Infra/diary-mcp.log`

The original five-tool Alarm admin adapter remains available at `gateway/src/mcp-server.mjs` solely for local backward compatibility. It lives inside the Automation module and is not deployed or connected as the Belly Home ChatGPT MCP. The production integration remains the single seven-tool `belly-home-mcp`.

## LaunchAgent configuration

Install the unified Belly Home LaunchAgent template with:

```bash
cd gateway
npm run launchd:install
```

The plist keeps its runtime cwd in `~/Library/Application Support/Belly Home Infra/gateway` and writes stdout/stderr to `~/Library/Logs/Belly Home Infra`.

## Production boundary

This is a complete private local deployment. Keep the Gateway and HTTP MCP bound to local/private interfaces. For ChatGPT development, use OpenAI Secure MCP Tunnel instead of publishing the Mac's ports. A public plugin submission would additionally require a stable HTTPS endpoint and OAuth 2.1.

## Optional APNs wake-up

Set `APNS_KEY_FILE`, `APNS_KEY_ID`, `APNS_TEAM_ID`, and `APNS_TOPIC` in `gateway/.env`. Use `APNS_ENVIRONMENT=development` for an Xcode development build and `production` for App Store/TestFlight signing. Push Notifications and the remote-notification background mode require a paid Apple Developer team. The checked-in project works with a free Personal Team and uses foreground manual sync; enable those capabilities once APNs credentials and a paid team are available.
