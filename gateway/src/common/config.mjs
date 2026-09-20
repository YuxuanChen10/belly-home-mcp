export const DEFAULT_BELLY_HOME_PORT = 8787;

export function getBellyHomePort(environment = process.env) {
  const value = environment.BELLY_HOME_PORT || String(DEFAULT_BELLY_HOME_PORT);
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || String(port) !== value || port < 1 || port > 65535) {
    throw new Error("BELLY_HOME_PORT must be an integer between 1 and 65535");
  }
  return port;
}

export function getBellyHomeBaseUrl(environment = process.env) {
  return `http://127.0.0.1:${getBellyHomePort(environment)}`;
}
