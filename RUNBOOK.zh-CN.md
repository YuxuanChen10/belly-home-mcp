# Belly Home MCP v0.2 运行手册

## 目录

- Gateway 代码：`/Users/cc/Documents/Codex/2026-09-15/belly-home-mcp/gateway`
- Diary 默认正文：`~/Library/Application Support/Belly Home Infra/Diary`
- Diary 默认审计日志：`~/Library/Logs/Belly Home Infra/diary-mcp.log`
- LaunchAgent 模板：`/Users/cc/Documents/Codex/2026-09-15/belly-home-mcp/launchd`

## 启动顺序

1. 确认 `.env` 已配置 `ALARM_GATEWAY_TOKEN`、`ALARM_PLUGIN_TOKEN`、`ALARM_DEVICE_ID`。
2. 启动 Gateway：`npm start`。
3. 启动 MCP HTTP：`npm run mcp:create:http`。
4. 运行 `npm run e2e:mcp -- "MCP test" 5` 做本地验收。

## LaunchAgent 安装

```bash
cd /Users/cc/Documents/Codex/2026-09-15/belly-home-mcp/gateway
npm run launchd:install
```

脚本会复制 plist，并打印 `launchctl` 命令。执行后可检查：

```bash
launchctl print gui/$(id -u)/com.belly.home.gateway
launchctl print gui/$(id -u)/com.belly.home.mcp-http
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8790/health
```

## 常见故障

- `ALARM_PLUGIN_TOKEN is required`：`.env` 没有配置 plugin token，或启动命令没有加载 `.env`。
- `plugin_not_configured`：Gateway 缺少 `ALARM_PLUGIN_TOKEN` 或 `ALARM_DEVICE_ID`。
- Diary 没生成文件：先查 MCP 调用结果，再查 `~/Library/Logs/Belly Home Infra/diary-mcp.log` 是否有 error。
- `queued` 不等于闹钟已设好：打开 iPhone App 点 `Sync now`，或等待 APNs 后台同步。

## 日常备份

v0.2 不自动 Git push。若要手动备份 Diary，可以复制整个 Diary 根目录，或后续迁移到 private GitHub repo。`.env`、日志、缓存和机器绝对路径不要进入仓库。

## 开发文件与实际运行文件的手动同步
```bash
DEV="/Users/cc/Documents/Codex/2026-09-15/belly-home-mcp/gateway"
RUN="$HOME/Library/Application Support/Belly Home Infra/gateway"

rsync -a \
  --exclude node_modules \
  --exclude .env \
  --exclude data \
  "$DEV"/ "$RUN"/

cd "$RUN"
npm ci --omit=dev

launchctl bootout gui/$(id -u)/com.belly.home.mcp-http 2>/dev/null || true
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.belly.home.mcp-http.plist" 2>/dev/null || true
launchctl kickstart -k gui/$(id -u)/com.belly.home.mcp-http
```

## 验收
```bash
curl http://127.0.0.1:8790/health
```
## 本地测试
```bash 
cd "$HOME/Library/Application Support/Belly Home Infra/gateway"
node --input-type=module - <<'NODE'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'check', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8790/mcp'));

await client.connect(transport);
console.log((await client.listTools()).tools.map(t => t.name).sort());
console.log(await client.callTool({ name: 'list_diary_entries', arguments: {} }));
await client.close();
NODE
```