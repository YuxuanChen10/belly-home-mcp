import { registerAutomationTools } from "../modules/automation/tools.mjs";
import { registerDesktopTools } from "../modules/desktop/index.mjs";
import { registerMemoryTools } from "../modules/memory/tools.mjs";

export function registerBellyHomeTools(server, dependencies) {
  registerAutomationTools(server, dependencies);
  registerMemoryTools(server, dependencies);
  registerDesktopTools(server, dependencies);
}
