# Belly Home MCP v0.2 验收

## 已实现范围
two functions:
- Gateway HTTP API：设备配对、创建闹钟、查询、修改、取消、手机命令同步、结果 ACK。
- Alarm MCP：`create_alarm` 保持最小权限，一次性闹钟创建仍走现有 plugin endpoint。

- Diary MCP：`append_diary(content, title?, tags?)`、`update_diary(id, patch)`、`read_diary(date?)`、`list_diary_entries(limit?, before?)`。
- Document MCP：`create_document(target, title, content, tags?, attachments?)`、`append_document(target, title?, content, attachments?)`、`read_document(target, title?, offset?, limit?)`；title 缺省时保留聚合文档行为，target 只允许 `design`、`development`、`knowledge`，不接受路径。
- Desktop MCP：`read_file_names()` 与 `move_files(snapshotId, moves)`；前者只建立 `~/Desktop` 第一层 Folder 与 Loose Files 的 metadata snapshot，后者只执行用户已经批准的 Loose Files 整理方案。
- Domain 隔离：Diary 只通过 Diary tools 访问；Document tools 必须拒绝 `daily`，也不能解析或访问 Diary 路径。
- Diary 存储：server 按 `Australia/Melbourne` 自动生成日期和时间；一天一个 UTF-8 Markdown 文件；同日 append-only。
- Diary 安全：tool contract 不接受 path；read/list 日期必须是 `YYYY-MM-DD`；不提供 delete、overwrite、rename、move 或任意 filesystem。
- Diary 日志：只记录调用 metadata，不记录正文、token、secret 或 `.env`。
- LaunchAgent：提供 Gateway 和 MCP HTTP 两个 plist，后台工作目录在 Application Support，日志在 Library/Logs。
- Desktop Helper：Swift + App Sandbox + security-scoped bookmark；不递归进入 Folder，隐藏项目、package 与符号链接不进入扫描结果。

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
- `server/discover` 返回 200，并明确协商到 SDK 实际支持的 `2025-11-25`；同一 endpoint 的 legacy initialize、tools/list 和 tools/call 回归流程继续通过。
- LaunchAgent plist 不依赖 Desktop、Documents 或 Downloads 作为工作目录。
- Desktop Helper 可列出无内容读取权限的文件名；取消汇总确认不产生改动；批准后只做同卷原子移动；同名目标自动变为 `(1)`、`(2)` 且保留原文件；`../` 路径逃逸被拒绝。

## 本地 MCP 端到端验收

Gateway 和 HTTP MCP 都运行时：

```bash
cd /Users/cc/Documents/Codex/2026-09-15/belly-home-mcp/gateway
npm run e2e:mcp -- "MCP test" 5
```

预期结果：

- MCP 工具清单包含现有八个工具以及 `read_file_names`、`move_files`。
- `create_alarm` 返回 `queued` 或 `scheduled`。
- `append_diary` 返回当天日期和时间。
- `read_diary` 能读回刚写入的内容。
- `list_diary_entries` 包含当天日期，且只返回 metadata。
- `read_document` 能读取固定逻辑 target，并返回分页信息与 `hasMore`。
- `create_document` 返回稳定 UUID、`version: 1`、`createdAt` 和 `updatedAt`，并创建独立 Markdown 文件。
- `read_document(target, title)` 与 `append_document(target, title, content)` 能以语义标题定位同一个 UUID 文档；追加后 version 和 `updatedAt` 更新。
- 同一 target 内规范化后重名的 title 会被拒绝，不同 target 可使用相同 title。
- `append_document` 和 `read_document` 都拒绝 `daily` target。
- `read_file_names` 只返回第一层 `folders` 与 `looseFiles`；Folder 内任何名称都不能出现在结果中，也不能读取文件内容。
- `move_files` 必须使用未过期 snapshot，且只能在用户审阅并明确批准方案后调用；只能移动第一层 Loose Files 到已有第一层 Folder，低置信度文件可进入唯一允许新建的 `Default/`。执行时等待一次本机批量汇总确认，自动编号同名目标，禁止 Folder 移动、改名、覆盖、跨卷、符号链接穿透和 Desktop 外路径。
- 授权窗口选择任何非 `~/Desktop` 路径都必须失败；bookmark 仅保存一次并在后续扫描中复用。

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
