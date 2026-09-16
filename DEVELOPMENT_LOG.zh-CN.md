# Belly Home MCP v0.2 开发日志

## 2026-09-16

- 阅读 `Diary_MCP_v0.2_系统开发说明.docx`，按规格识别 Diary v0.2 范围。
- 复用现有 `gateway` Node ESM 项目，没有新建平行基础设施。
- 新增 `DiaryStore`，负责 Markdown 文件创建、追加、读取和列表。
- 在 create-only MCP server 中新增 `append_diary`、`read_diary`、`list_diary_entries`。
- 新增 Diary 审计日志，避免正文和 secret 进入运行日志。
- 更新 MCP 端到端脚本，覆盖 alarm + diary tools。
- 新增 Gateway/MCP LaunchAgent plist 和安装脚本。
- 补充 README、MCP_SETUP、ACCEPTANCE、RUNBOOK、SECURITY、ROADMAP。
- 运行 `npm test`，自动测试通过。
