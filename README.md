# Belly Home MCP

This private local project connects natural-language requests to three home domains:

- Alarm: create app-owned iPhone alarms through the existing Alarm Gateway and iOS app.
- Diary: append, read, and list private Markdown diary entries through the same MCP boundary.
- Desktop: scan the complete `~/Desktop` workspace without reading content, let GPT propose an organization plan, then apply that reviewed plan after one native summary confirmation.

## What is included

- `gateway/`: one persistent HTTP service for the Gateway API and MCP. The create-only MCP exposes alarm creation plus document tools.
- `gateway/src/gateway/`: transport, dependency composition, and tool registration for the single `belly-home-mcp` server.
- `gateway/src/modules/`: business-domain implementations. Memory owns Diary/Documents, Automation owns Alarm, and Desktop owns metadata-only workspace organization.
- `gateway/native/desktop-helper/`: signed, sandboxed Swift helper for Desktop metadata enumeration and batch-confirmed atomic moves.
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

In Xcode, select your development team, change the bundle identifier if needed, and run on the iPhone. The app defaults to `https://alarm.bellyjuris.com`; create a pairing code with `npm run pairing-code`, and pair the phone. Grant AlarmKit permission, then use **Sync now** after creating an alarm through the API or MCP tool.

For a physical phone, the gateway URL cannot be `localhost` because that points back to the phone. Use `https://alarm.bellyjuris.com`; a Mac LAN address such as `http://192.168.1.20:8787` is only a local-development fallback. Foreground synchronization is always available for deterministic testing. When APNs credentials are configured, the gateway also sends a background wake-up after each queued change; iOS still decides when background work runs, so queued status remains truthful until the phone ACK arrives.

## MCP configuration

For the final least-privilege integration, start the gateway first and register this command as a local MCP server:

```bash
node --env-file=/absolute/path/to/gateway/.env /absolute/path/to/gateway/src/mcp-create-server.mjs
```

It exposes ten tools: the existing Alarm, Diary, and Document tools plus `read_file_names` and `move_files`. Desktop access is rooted permanently at `~/Desktop`; it is never an arbitrary folder selected for management. `read_file_names` returns only first-level folder names and loose-file names, relative paths, and extensions. It never scans inside folders or reads file contents. GPT analyzes only loose files, uses the existing folders as user-defined categories, and presents a proposal before execution. Low-confidence files should go to `Default/`. The native helper skips hidden items, packages, and symbolic links and shows one on-device summary confirmation for the complete approved plan. `move_files` can only move loose files into existing first-level folders; `Default/` is the sole folder it may create. Destination conflicts are resolved as `Name (1)`, `Name (2)`, and so on without overwriting. The configured phone ID is never accepted from the MCP caller, and the MCP process uses `ALARM_PLUGIN_TOKEN`, which is accepted only by the create-only Gateway route. Diary is the private life domain. Document is the shareable knowledge domain and never accepts a file path.

Build and authorize the native Desktop Helper once before using Desktop tools:

```bash
cd gateway
npm run desktop:build
npm run desktop:authorize
```

The helper is packaged as a background-only macOS app so its App Sandbox and security-scoped bookmark have a stable application identity. Development builds use ad-hoc signing when `BELLY_DESKTOP_SIGNING_IDENTITY` is unset and may require reauthorization after a rebuild. Set that environment variable to a stable code-signing identity for persistent authorization across updates.

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
- `BELLY_DESKTOP_HELPER_PATH`, optional override for the signed native helper
- `DESKTOP_LOG_FILE`, default `~/Library/Logs/Belly Home Infra/desktop-mcp.log`

The original five-tool Alarm admin adapter remains available at `gateway/src/mcp-server.mjs` solely for local backward compatibility. It lives inside the Automation module and is not deployed or connected as the Belly Home ChatGPT MCP. The production integration remains the single ten-tool `belly-home-mcp`.

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
