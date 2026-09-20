# Belly Home MCP v0.2 运行与连接

这个版本使用一个进程和一个 `BELLY_HOME_PORT` 同时提供 Gateway API 与 MCP。MCP 暴露七个工具：

- `create_alarm`
- `append_diary`
- `update_diary`
- `read_diary`
- `list_diary_entries`
- `append_document`
- `read_document`

## 权限边界

- Alarm 仍然只支持创建一次性闹钟；手机 ID 固定在 Gateway `.env`，AI 客户端不能指定设备。
- Diary 写入不接受 path 或 date；`append_diary` 由 server 按 `Australia/Melbourne` 生成当天文件和当前 `HH:mm`。
- Diary 文件是 UTF-8 Markdown，一天一个 `YYYY-MM-DD.md`，默认保存在 `~/Library/Application Support/Belly Home Infra/Diary`。
- Diary 调用日志默认写入 `~/Library/Logs/Belly Home Infra/diary-mcp.log`，只记录 tool、耗时、状态、日期和字符数，不记录正文、token 或 `.env`。
- Diary 是私人的人生记录，只能通过 `append_diary`、`read_diary`、`update_diary`、`list_diary_entries` 访问。
- Document 是可分享的知识记录；`append_document` 和 `read_document` 只接受 `design`、`development`、`knowledge`，其中读取的 `offset` 和 `limit` 按 Unicode 字符分页。Document 不接受 `daily` 或文件路径。
- Cloudflare Tunnel 只发布统一端口上的 `/mcp` 路径。

## 首次设置

需要 Node.js 22 或更高版本。

```bash
cd "/Users/cc/Desktop/ideas/belly home/belly-home-mcp/gateway"
npm install
cp .env.example .env
```

在 `.env` 中填写：

```dotenv
BELLY_HOME_PORT=8787
ALARM_GATEWAY_TOKEN=<管理用随机 token>
ALARM_PLUGIN_TOKEN=<另一枚随机 token>
ALARM_DEVICE_ID=<已经配对的 iPhone ID>
ALARM_TIMEZONE=Australia/Melbourne
DIARY_ROOT_DIR=
DIARY_LOG_FILE=
```

可用 `openssl rand -hex 32` 分别生成两枚 token。不要把 `.env` 发给 MCP 客户端或提交到版本库。

## 手动启动

启动统一的 Gateway + MCP 服务：

```bash
cd "/Users/cc/Desktop/ideas/belly home/belly-home-mcp/gateway"
npm start
```

Gateway 健康检查是 `http://127.0.0.1:8787/health`，MCP 地址是 `http://127.0.0.1:8787/mcp`。普通 MCP 客户端可参考 `gateway/mcp-http.example.json`。

## LaunchAgent 启动

项目提供一个 LaunchAgent plist：

- `launchd/com.belly.home.gateway.plist`

安装模板并创建运行目录：

```bash
cd "/Users/cc/Desktop/ideas/belly home/belly-home-mcp/gateway"
npm run launchd:install
```

脚本会复制 plist 到 `~/Library/LaunchAgents`，并打印 `launchctl bootstrap` / `kickstart` 命令。plist 的 `WorkingDirectory` 是 `~/Library/Application Support/Belly Home Infra/gateway`。

## 端到端测试

统一服务运行时，执行：

```bash
cd "/Users/cc/Desktop/ideas/belly home/belly-home-mcp/gateway"
npm run e2e:mcp -- "MCP test" 5
```

脚本会确认 MCP 暴露七个工具，并检查 alarm、diary update 和 document read 调用链。

## 连接 ChatGPT

ChatGPT 不能直接访问本机地址。Tunnel 的 origin 与 Gateway、MCP 使用同一个 `BELLY_HOME_PORT`：

```bash
export CONTROL_PLANE_API_KEY="sk-..."
tunnel-client init --profile belly-home --tunnel-id tunnel_... --mcp-server-url http://127.0.0.1:8787/mcp
tunnel-client doctor --profile belly-home --explain
tunnel-client run --profile belly-home
```

在 ChatGPT Developer mode 中刷新现有 Plugin。扫描工具时应看到 `create_alarm`、`append_diary`、`update_diary`、`read_diary`、`list_diary_entries`、`append_document`、`read_document`。
