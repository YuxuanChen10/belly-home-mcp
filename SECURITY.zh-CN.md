# Belly Home MCP v0.2 安全说明

## 当前边界

- MCP 只暴露七个明确工具，不提供任意 filesystem。
- `append_diary` 不接受 path 或 date，写入位置由 server 决定。
- `read_diary` 和 `list_diary_entries` 的日期参数必须是严格 `YYYY-MM-DD`。
- Diary 正文不写入运行日志；审计日志只记录 metadata。
- Alarm MCP 使用 `ALARM_PLUGIN_TOKEN`，不能访问 Gateway 管理接口。
- 统一服务可供局域网中的 iPhone 连接，但 `/mcp` 只接受本机回环连接；Cloudflare Tunnel 的本地 origin 应指向 `127.0.0.1`。

## 不进入 Git 的内容

- `.env`
- token、secret、Authorization header
- Diary 正文，除非后续明确迁移到 private diary repo
- `~/Library/Logs/...`
- Gateway `data/gateway.json` 中的真实设备 token

## 风险与缓解

- 本机账号被攻破时，Diary Markdown 仍是本地明文文件。v0.2 依赖 macOS 用户账户和磁盘加密保护。
- ChatGPT / MCP 客户端能读取指定日期的完整 Diary 正文；只连接信任的私有客户端。
- Secure MCP Tunnel、Cloudflare Access、rate limit 仍是安全加固重点；公网暴露前必须重新评估。
- 删除、覆盖、重命名和移动能力未实现，这是刻意降低数据破坏风险。
