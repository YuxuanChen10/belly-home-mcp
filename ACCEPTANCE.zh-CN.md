# Belly Home MCP v0.2 验收

## 已实现范围
two functions:
- Gateway HTTP API：设备配对、创建闹钟、查询、修改、取消、手机命令同步、结果 ACK。
- Alarm MCP：`create_alarm` 保持最小权限，一次性闹钟创建仍走现有 plugin endpoint。

- Diary MCP：`append_diary(content, title?)`、`read_diary(date?)`、`list_diary_entries(limit?, before?)`。
- Diary 存储：server 按 `Australia/Melbourne` 自动生成日期和时间；一天一个 UTF-8 Markdown 文件；同日 append-only。
- Diary 安全：tool contract 不接受 path；read/list 日期必须是 `YYYY-MM-DD`；不提供 delete、overwrite、rename、move 或任意 filesystem。
- Diary 日志：只记录调用 metadata，不记录正文、token、secret 或 `.env`。
- LaunchAgent：提供 Gateway 和 MCP HTTP 两个 plist，后台工作目录在 Application Support，日志在 Library/Logs。

## 自动验收

Mac 上执行：

```bash
cd /Users/cc/Documents/Codex/2026-09-15/belly-home-mcp/gateway
npm test
```

预期结果：全部测试通过，包括：

- Diary 文件创建、追加、读取、列表、非法日期和超长正文。
- create-only Gateway 权限隔离和 rate limit。
- Alarm 回归流程。
- stdio MCP 暴露 alarm + diary tools，并实际 append/read/list。
- Streamable HTTP MCP 端到端创建 alarm。
- LaunchAgent plist 不依赖 Desktop、Documents 或 Downloads 作为工作目录。

## 本地 MCP 端到端验收

Gateway 和 HTTP MCP 都运行时：

```bash
cd /Users/cc/Documents/Codex/2026-09-15/belly-home-mcp/gateway
npm run e2e:mcp -- "MCP test" 5
```

预期结果：

- MCP 工具清单包含 `create_alarm`、`append_diary`、`read_diary`、`list_diary_entries`。
- `create_alarm` 返回 `queued` 或 `scheduled`。
- `append_diary` 返回当天日期和时间。
- `read_diary` 能读回刚写入的内容。
- `list_diary_entries` 包含当天日期，且只返回 metadata。

## 真机验收

Alarm 真机验收仍按原流程：

1. iPhone 与 Gateway 完成配对。
2. `.env` 中 `ALARM_DEVICE_ID` 指向配对后的设备 ID。
3. 通过 MCP 创建一个 5 分钟后的闹钟。
4. 未配置 APNs 时在 App 点击 `Sync now`。
5. 只有状态为 `scheduled` 才表示手机已成功写入 AlarmKit。

Diary 真机无 iPhone 依赖；验收重点是 ChatGPT 通过 Secure MCP Tunnel 实际调用三个 Diary tools，并检查本机 Diary 根目录下生成 `YYYY-MM-DD.md`。

## 当前已知限制

- 无法自动重启LaunchAgent；已提供 plist、安装脚本和自动校验。
- Secure MCP Tunnel / ChatGPT 端到端需要用户账号和 tunnel 连接环境，本轮用 MCP SDK 本地端到端脚本覆盖。
- 自动 Git push、搜索、embedding、Web UI、富文本编辑器均按 v0.2 明确不做。（后期开发）
