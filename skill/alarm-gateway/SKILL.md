---
name: alarm-gateway
description: Create, inspect, update, or cancel app-owned iPhone alarms through the Alarm Gateway MCP tools. Use when the user asks GPT or Codex to manage an alarm on their paired iPhone; do not use for generic reminders or calendar events.
---

# Alarm Gateway

Translate the user's alarm request into the smallest necessary Alarm Gateway MCP operation.

## Operating rules

- Use `create_alarm` for an explicit request to set a new alarm. Resolve relative dates using the current date and the user's intended IANA time zone, then send a one-time RFC 3339 timestamp with an explicit offset.
- Use a weekly schedule only when the user explicitly asks for repeating weekdays. Preserve the requested local hour, minute, weekdays, and time zone.
- Ask one concise clarification when the time, date, AM/PM, recurrence, or target alarm is genuinely ambiguous. Do not guess a wake-up time.
- Use `list_alarms` before updating or cancelling when the target is not uniquely identified. Require explicit confirmation before cancelling multiple alarms.
- Treat repeated attempts as one operation: reuse a stable `idempotencyKey` when retrying the same create request.
- A `queued` or `cancelling` response means the phone has not applied the change yet. Say that it is waiting for iPhone synchronization.
- Only say an alarm is set when `get_alarm_status` or `list_alarms` reports `scheduled`. Report `failed` with the returned reason and do not silently create a replacement.
- AlarmKit alarms belong to the Alarm Gateway app; do not claim they appear in Apple's Clock app.

For field definitions and status transitions, read [references/tool-contract.md](references/tool-contract.md).
