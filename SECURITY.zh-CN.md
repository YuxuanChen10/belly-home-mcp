# Belly Home MCP v0.2 安全说明

## 当前边界

- MCP 只暴露十个明确工具，不提供任意 filesystem。
- `append_diary` 不接受 path 或 date，写入位置由 server 决定。
- `read_diary` 和 `list_diary_entries` 的日期参数必须是严格 `YYYY-MM-DD`。
- Diary 正文不写入运行日志；审计日志只记录 metadata。
- Document 标题不会参与文件路径；路径只由固定 target 和 Gateway 生成的 UUID 决定。Gateway 使用内部标题索引进行唯一性检查和语义路由，并使用独占写入避免覆盖。
- Desktop 由签名 Swift Helper 访问，Gateway 不直接扫描 Desktop。Helper 的授权目标被硬编码并二次验证为当前用户的 `~/Desktop`，不能保存任意文件夹 bookmark。
- `read_file_names` 只列出 Desktop 第一层已有 Folder 和 Loose Files，metadata 白名单只有名称、相对路径和扩展名。Folder 内部永不扫描；隐藏项目、package 和符号链接被跳过；不实现 read/open/parse/OCR/content index。
- `move_files` 只允许把 snapshot 中的第一层 Loose Files 移入 snapshot 中已有的第一层 Folder；`Default/` 是唯一允许在确认后创建的 Folder。它使用相对路径、inode/device identity、root directory descriptor、`RENAME_EXCL` 和 `RENAME_NOFOLLOW_ANY`；同名目标在确认前自动编号，禁止改名、覆盖、跨卷与路径逃逸。
- 每批 move 只显示一个汇总 NSAlert，并必须等待本机用户确认。不会为每个 item 分别弹窗，ChatGPT 的请求本身不构成授权。
- Desktop Helper 子进程只接收 PATH、HOME、TMPDIR 和 LANG，不继承 Alarm token 或其他 Gateway secret。
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
- Desktop Domain 是 Loose Files Organizer，不是文件管理器。它只有 Desktop 第一层名称读取与批准方案执行能力，没有 Folder 内容扫描、Folder 移动、任意文件夹授权，也没有通用删除、覆盖、复制或重命名 API。macOS 没有独立的 metadata-only 文件权限，因此该承诺由 App Sandbox、窄 Helper 接口、代码审计与测试共同保证。
