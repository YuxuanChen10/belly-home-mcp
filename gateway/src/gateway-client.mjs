export class GatewayClient {
  constructor({ baseUrl, token, deviceId }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.deviceId = deviceId;
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        ...options.headers
      }
    });
    const value = await response.json();
    if (!response.ok) throw new Error(`${value.error?.code || response.status}: ${value.error?.message || "gateway request failed"}`);
    return value;
  }

  createAlarm(input) {
    return this.request("/v1/alarms", {
      method: "POST",
      body: JSON.stringify({ ...input, deviceId: this.deviceId })
    });
  }

  listAlarms(includeCancelled = false) {
    const query = new URLSearchParams({ deviceId: this.deviceId, includeCancelled: `${includeCancelled}` });
    return this.request(`/v1/alarms?${query}`);
  }

  getAlarm(alarmId) {
    return this.request(`/v1/alarms/${encodeURIComponent(alarmId)}`);
  }

  updateAlarm(alarmId, patch) {
    return this.request(`/v1/alarms/${encodeURIComponent(alarmId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
  }

  cancelAlarm(alarmId) {
    return this.request(`/v1/alarms/${encodeURIComponent(alarmId)}`, { method: "DELETE" });
  }
}

export class CreateAlarmGatewayClient {
  constructor({ baseUrl, token }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  async createAlarm(input) {
    const response = await fetch(`${this.baseUrl}/v1/plugin/alarms`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(input)
    });
    const value = await response.json();
    if (!response.ok) throw new Error(`${value.error?.code || response.status}: ${value.error?.message || "alarm creation failed"}`);
    return value;
  }
}
