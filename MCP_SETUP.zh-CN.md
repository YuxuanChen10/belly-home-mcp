# Belly Home MCP v0.2 运行与连接

这个版本使用一个进程和一个 `BELLY_HOME_PORT` 同时提供 Gateway API 与 MCP。MCP 暴露十个工具：

- `create_alarm`
- `append_diary`
- `update_diary`
- `read_diary`
- `list_diary_entries`
- `create_document`
- `append_document`
- `read_document`
- `read_file_names`
- `move_files`

## 权限边界

- Alarm 仍然只支持创建一次性闹钟；手机 ID 固定在 Gateway `.env`，AI 客户端不能指定设备。
- Diary 写入不接受 path 或 date；`append_diary` 由 server 按 `Australia/Melbourne` 生成当天文件和当前 `HH:mm`。
- Diary 文件是 UTF-8 Markdown，一天一个 `YYYY-MM-DD.md`，默认保存在 `~/Library/Application Support/Belly Home Infra/Diary`。
- Diary 调用日志默认写入 `~/Library/Logs/Belly Home Infra/diary-mcp.log`，只记录 tool、耗时、状态、日期和字符数，不记录正文、token 或 `.env`。
- Diary 是私人的人生记录，只能通过 `append_diary`、`read_diary`、`update_diary`、`list_diary_entries` 访问。
- Document 是可分享的知识记录；`create_document` 创建带稳定 UUID、时间戳和首个版本的独立文档，存放在对应 target 的 `Documents/<uuid>.md`。`read_document` 与 `append_document` 可选传入 title，由 Gateway 路由到 UUID 文档；不传 title 时保持原有聚合文档行为。同一 target 内标题经过 Unicode 规范化并忽略大小写后必须唯一。Document tools 不接受 `daily` 或文件路径。
- Desktop 的唯一 root 是 `~/Desktop`，不能授权或切换到任意文件夹。`read_file_names` 只读取第一层已有 Folder 和 Loose Files 的名称、相对路径与扩展名，不进入任何 Folder，也不读取文件内容。GPT 只分析 Loose Files，把已有第一层 Folder 视为用户定义的分类；低置信度文件使用 `Default/`。用户明确同意整理方案后才能调用 `move_files`。它只能把第一层 Loose Files 移入已有第一层 Folder，唯一可新建的目标是 `Default/`。每批执行只显示一个 Mac 原生汇总确认窗口；同名目标自动增加 `(1)`、`(2)` 后缀，绝不覆盖。
- Cloudflare Tunnel 只发布统一端口上的 `/mcp` 路径。

## 首次设置

需要 Node.js 22 或更高版本。

```bash
cd "/Users/cc/Desktop/ideas/belly home/belly-home-mcp/gateway"
npm install
cp .env.example .env
npm run desktop:build
npm run desktop:authorize
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

脚本会确认 MCP 暴露十个工具，并检查 alarm、diary update 和 document read 调用链。完整 `npm test` 还会验证 Desktop metadata、路径隔离、确认取消和原子移动。

## 连接 ChatGPT

ChatGPT 不能直接访问本机地址。Tunnel 的 origin 与 Gateway、MCP 使用同一个 `BELLY_HOME_PORT`：

```bash
export CONTROL_PLANE_API_KEY="sk-..."
tunnel-client init --profile belly-home --tunnel-id tunnel_... --mcp-server-url http://127.0.0.1:8787/mcp
tunnel-client doctor --profile belly-home --explain
tunnel-client run --profile belly-home
```

在 ChatGPT Developer mode 中刷新现有 Plugin。工具清单中还应看到 `read_file_names` 和 `move_files`。
