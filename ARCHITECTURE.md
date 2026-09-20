# Belly Home Architecture Specification v0.1

## Decision

Belly Home has one production MCP server: `belly-home-mcp`.

New capabilities are added as business-domain modules. A separate MCP server is justified only when the capability requires an independently deployed runtime, such as a Mac Desktop Agent, an iPhone Agent, or a Cloud Agent.

The MCP server is a communication gateway, not a business boundary.

## Source Structure

```text
gateway/src/
├── gateway/
│   ├── server.mjs
│   ├── tool-registry.mjs
│   ├── dependencies.mjs
│   ├── mcp-http-app.mjs
│   ├── unified-http-server.mjs
│   └── runtime.mjs
├── modules/
│   ├── memory/
│   │   ├── diary/
│   │   ├── document/
│   │   ├── audit.mjs
│   │   ├── audit-log.mjs
│   │   └── tools.mjs
│   ├── automation/
│   │   ├── alarm/
│   │   └── tools.mjs
│   └── desktop/
│       └── index.mjs
└── common/
    ├── config.mjs
    ├── errors.mjs
    └── mcp-result.mjs
```

Files retained directly under `src/` are compatibility entry points. They must remain thin imports or re-exports and must not accumulate business logic.

The legacy Alarm admin stdio adapter is retained only to avoid breaking local maintenance workflows. It belongs to Automation, is not connected to ChatGPT, and must not become a second product integration.

## Domain Responsibilities

### Gateway

- MCP transport
- Dependency composition
- Tool registration and request routing
- No Diary, Document, Alarm, or future Desktop business rules

### Memory

- Private Diary lifecycle
- Shareable Design, Development, and Knowledge documents
- Content audit metadata
- Future Home Rule and memory management

Diary and Document remain separate subdomains. Diary tools never route through Document targets.

### Automation

- Alarm business rules and persistence
- iPhone command synchronization and acknowledgements
- APNs wake-up
- Future Reminder, Calendar, and workflow automation

### Desktop

- Reserved boundary only
- No tools or behavior in v0.1
- Future indexing, file search, organization, and Finder integration

## Evolution Rule

Add a Domain Module for a feature boundary. Add another MCP server only for an independent deployment boundary.

The AI-facing workflow remains:

```text
Read -> Reason -> Classify -> Append
```

Users should not need to manage storage paths, routing, destinations, or module boundaries.

## Constraints

- Preserve all current MCP tool names, schemas, and behavior.
- Keep one production MCP server.
- Prefer simple module ownership over framework-like abstraction.
- Do not implement Desktop behavior until it is explicitly requested.
