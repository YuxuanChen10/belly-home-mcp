# Belly Home MCP Roadmap

## v0.2 已完成

- 在现有 Gateway/MCP 边界中加入 Diary 模块。
- 实现 append/read/list 三个 Diary tools。
- 一天一个 Markdown 文件，同日 append-only。
- 加入安全校验、审计日志、自动测试、LaunchAgent 模板和运行文档。
问题：1.开发和运行文件的同步问题，依赖安装脚本，需要手动terminal 迁移
     2.session问题还没successful
     3.

## v0.3 建议

- 通过 Secure MCP Tunnel 做真实 ChatGPT 端到端验收。
- 将 Diary 内容迁移到 private GitHub repo，设计手动备份和恢复流程。
- 增加普通全文搜索，不做 embedding。
- 增加只读 Web UI：左侧日期时间轴，右侧 Markdown 阅读。
- 补 Cloudflare Access / tunnel 运行文档和公开暴露前安全检查。

## 明确暂不做

- delete / overwrite / rename / move。
- 任意 filesystem MCP。
- 数据库、向量数据库、embedding、自动摘要索引。
- 自动 Git push / 冲突解决。
- 复杂富文本编辑器和 UI 重构。
