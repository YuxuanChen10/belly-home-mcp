import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const DEFAULT_HELPER_PATH = fileURLToPath(
  new URL("../../../native/desktop-helper/bin/BellyHomeDesktopHelper.app/Contents/MacOS/belly-desktop-helper", import.meta.url)
);

export class DesktopHelperError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DesktopHelperError";
    this.code = code;
  }
}

function helperEnvironment(environment) {
  return Object.fromEntries(Object.entries({
    PATH: environment.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: environment.HOME || homedir(),
    TMPDIR: environment.TMPDIR || tmpdir(),
    LANG: environment.LANG || "en_US.UTF-8"
  }).filter(([, value]) => value !== undefined));
}

export class DesktopHelperClient {
  constructor({
    helperPath = process.env.BELLY_DESKTOP_HELPER_PATH || DEFAULT_HELPER_PATH,
    helperArguments = [],
    environment = process.env,
    listTimeoutMs = 30_000,
    moveTimeoutMs = 15 * 60_000,
    maxOutputBytes = 8 * 1024 * 1024
  } = {}) {
    this.helperPath = helperPath;
    this.helperArguments = helperArguments;
    this.environment = helperEnvironment(environment);
    this.listTimeoutMs = listTimeoutMs;
    this.moveTimeoutMs = moveTimeoutMs;
    this.maxOutputBytes = maxOutputBytes;
  }

  async invoke(command, request, timeoutMs) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.helperPath, [...this.helperArguments, command], {
        stdio: ["pipe", "pipe", "pipe"],
        env: this.environment,
        shell: false
      });
      const stdout = [];
      const stderr = [];
      let outputBytes = 0;
      let settled = false;
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new DesktopHelperError("HELPER_TIMEOUT", `Desktop Helper ${command} timed out`));
      }, timeoutMs);

      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(result);
      };

      child.once("error", (error) => {
        const code = error.code === "ENOENT" ? "HELPER_NOT_INSTALLED" : "HELPER_START_FAILED";
        finish(new DesktopHelperError(code, "Desktop Helper could not be started"));
      });
      child.stdout.on("data", (chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > this.maxOutputBytes) {
          child.kill("SIGTERM");
          finish(new DesktopHelperError("HELPER_OUTPUT_TOO_LARGE", "Desktop Helper returned too much data"));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk) => stderr.push(chunk));
      child.once("exit", (code) => {
        if (settled) return;
        let response;
        try {
          response = JSON.parse(Buffer.concat(stdout).toString("utf8"));
        } catch {
          const detail = Buffer.concat(stderr).toString("utf8").trim();
          finish(new DesktopHelperError(
            "INVALID_HELPER_RESPONSE",
            detail ? `Desktop Helper returned an invalid response: ${detail}` : "Desktop Helper returned an invalid response"
          ));
          return;
        }
        if (code !== 0 || response.status === "error") {
          finish(new DesktopHelperError(
            response.code || "HELPER_FAILED",
            response.message || "Desktop Helper failed"
          ));
          return;
        }
        finish(null, response);
      });

      child.stdin.end(JSON.stringify(request || {}));
    });
  }

  readFileNames() {
    return this.invoke("list", {}, this.listTimeoutMs);
  }

  moveFiles({ snapshotId, moves } = {}) {
    return this.invoke("move", { snapshotId, moves }, this.moveTimeoutMs);
  }
}
