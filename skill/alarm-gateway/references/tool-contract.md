# Alarm Gateway tool contract

## Schedule shapes

One-time alarm:

```json
{
  "kind": "once",
  "fireAt": "2026-09-16T07:30:00+10:00"
}
```

Weekly alarm:

```json
{
  "kind": "weekly",
  "hour": 7,
  "minute": 30,
  "weekdays": ["monday", "tuesday", "wednesday", "thursday", "friday"],
  "timeZone": "Australia/Melbourne"
}
```

Weekdays are lowercase English names. Hours use the 24-hour clock.

## Status transitions

- `queued`: create or update awaits phone synchronization.
- `scheduled`: the phone acknowledged successful AlarmKit scheduling.
- `cancelling`: cancellation awaits phone synchronization.
- `cancelled`: the phone acknowledged cancellation.
- `failed`: the phone rejected or could not apply the latest command; inspect `statusMessage`.

## Tools

- `create_alarm`: label, schedule, and optional stable idempotency key.
- `list_alarms`: optionally include cancelled alarms.
- `get_alarm_status`: exact lookup by alarm ID.
- `update_alarm`: alarm ID and at least one of label or schedule.
- `cancel_alarm`: exact alarm ID; cancellation is asynchronous until phone ACK.
