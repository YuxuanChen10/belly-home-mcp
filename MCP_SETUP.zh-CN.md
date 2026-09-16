# Belly Home MCP v0.2 运行与连接

这个版本复用已通过真机测试的 Alarm Gateway，并在同一个私有 MCP 边界内加入 Diary 模块。MCP 暴露四个工具：

- `create_alarm`
- `append_diary`
- `read_diary`
- `list_diary_entries`

## 权限边界

- Alarm 仍然只支持创建一次性闹钟；手机 ID 固定在 Gateway `.env`，AI 客户端不能指定设备。
- Diary 写入不接受 path 或 date；`append_diary` 由 server 按 `Australia/Melbourne` 生成当天文件和当前 `HH:mm`。
- Diary 文件是 UTF-8 Markdown，一天一个 `YYYY-MM-DD.md`，默认保存在 `~/Library/Application Support/Belly Home Infra/Diary`。
- Diary 调用日志默认写入 `~/Library/Logs/Belly Home Infra/diary-mcp.log`，只记录 tool、耗时、状态、日期和字符数，不记录正文、token 或 `.env`。
- HTTP MCP 默认只监听 `127.0.0.1`；若绑定到非 loopback 地址，必须配置 `ALARM_MCP_BEARER_TOKEN`。

## 首次设置

需要 Node.js 22 或更高版本。

```bash
cd /Users/cc/Documents/Codex/2026-09-15/belly-home-mcp/gateway
npm install
cp .env.example .env
```

在 `.env` 中填写：

```dotenv
ALARM_GATEWAY_TOKEN=<管理用随机 token>
ALARM_PLUGIN_TOKEN=<另一枚随机 token>
ALARM_DEVICE_ID=<已经配对的 iPhone ID>
ALARM_GATEWAY_URL=http://127.0.0.1:8787
ALARM_TIMEZONE=Australia/Melbourne
DIARY_ROOT_DIR=
DIARY_LOG_FILE=
```

可用 `openssl rand -hex 32` 分别生成两枚 token。不要把 `.env` 发给 MCP 客户端或提交到版本库。

## 手动启动

终端 1，启动 Gateway：

```bash
cd /Users/cc/Documents/Codex/2026-09-15/belly-home-mcp/gateway
npm start
```

终端 2，启动 Streamable HTTP MCP：

```bash
cd /Users/cc/Documents/Codex/2026-09-15/belly-home-mcp/gateway
npm run mcp:create:http
```

MCP 地址是 `http://127.0.0.1:8790/mcp`。普通 MCP 客户端可参考 `gateway/mcp-http.example.json`；支持 stdio 的客户端可参考 `gateway/mcp-create.example.json`，不需要启动 HTTP MCP。

## LaunchAgent 启动

项目提供两个 LaunchAgent plist：

- `launchd/com.belly.home.gateway.plist`
- `launchd/com.belly.home.mcp-http.plist`

安装模板并创建运行目录：

```bash
cd /Users/cc/Documents/Codex/2026-09-15/belly-home-mcp/gateway
npm run launchd:install
```

脚本会复制 plist 到 `~/Library/LaunchAgents`，并打印 `launchctl bootstrap` / `kickstart` 命令。两个 plist 的 `WorkingDirectory` 都是 `~/Library/Application Support/Belly Home Infra/Runtime`，不依赖 Desktop、Documents 或 Downloads 作为 cwd。

## 端到端测试

Gateway 和 HTTP MCP 都运行时，执行：

```bash
cd /Users/cc/Documents/Codex/2026-09-15/belly-home-mcp/gateway
npm run e2e:mcp -- "MCP test" 5
```

脚本会确认 MCP 暴露四个 v0.2 工具，创建一个 5 分钟后的闹钟，再实际调用 `append_diary`、`read_diary`、`list_diary_entries`。返回 `queued` 时，在 iPhone 的 Alarm Gateway 中点 `Sync now`；App 显示已确认或返回 `scheduled` 后，才表示 AlarmKit 已接受。

## 连接 ChatGPT

ChatGPT 不能直接访问本机地址。开发测试建议使用 OpenAI Secure MCP Tunnel，保持 Gateway 和 MCP 都不暴露到公网：

```bash
export CONTROL_PLANE_API_KEY="sk-..."
tunnel-client init --profile belly-home --tunnel-id tunnel_... --mcp-server-url http://127.0.0.1:8790/mcp
tunnel-client doctor --profile belly-home --explain
tunnel-client run --profile belly-home
```

在 ChatGPT Developer mode 中创建 Plugin，Connection 选择 Tunnel，再选这个 tunnel。扫描工具时应看到 `create_alarm`、`append_diary`、`read_diary`、`list_diary_entries`。
