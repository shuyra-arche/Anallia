import type { Command } from "./types.ts";

/** The spatial subject of a command, shared by DOM and numeric hit feedback. */
export function commandReference(command: Command | undefined): string | null {
  if (command?.type === "navigate" && !command.target.startsWith("act:"))
    return command.target;
  return command?.type === "focus" ? `hub:${command.hub}` : null;
}
