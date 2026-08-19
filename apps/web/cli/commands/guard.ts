/**
 * `commitai guard` — the prompt-injection defence from lib/ai/promptGuards.
 *
 * Exposes the exact functions the AI layer uses to fence untrusted goal/evidence
 * text, so you can inspect or pre-process text the same way the app does. All pure:
 * no network, no model, no key.
 */
import {
  neutralizeDelimiters,
  wrapGoalData,
  wrapEvidence,
  buildSystemInstruction,
} from "../../lib/ai/promptGuards";
import {
  contentFromSources,
  emit,
  printHelp,
  usage,
  EXIT_OK,
  type GlobalOptions,
} from "../runtime";
import { parse } from "../format";

export const HELP = `
${"commitai guard"} — prompt-injection defence helpers (pure)

Usage:
  commitai guard neutralize      [--text <s> | --file <path> | <stdin>]
  commitai guard wrap-goal       [--text <s> | --file <path> | <stdin>]
  commitai guard wrap-evidence   [--text <s> | --file <path> | <stdin>]
  commitai guard system-prompt   [--policy <s>]

Commands:
  neutralize       Strip any of CommitAI's fence delimiters from untrusted text.
  wrap-goal        Wrap text as fenced, untrusted goal data.
  wrap-evidence    Wrap text as fenced, untrusted evidence data.
  system-prompt    Print the model's system instruction (optionally with a task policy).

Input: use --text, or --file, or pipe text on stdin.`;

export async function run(
  command: string | undefined,
  args: string[],
  global: GlobalOptions,
): Promise<number> {
  if (global.help || command === undefined) {
    printHelp(HELP);
    return EXIT_OK;
  }

  if (command === "system-prompt") {
    const { values } = parse(args, { policy: { type: "string" } });
    const policy = typeof values["policy"] === "string" ? values["policy"] : undefined;
    const prompt = buildSystemInstruction(policy);
    emit({ systemPrompt: prompt }, global, () => prompt);
    return EXIT_OK;
  }

  const transformers: Record<string, (t: string) => string> = {
    neutralize: neutralizeDelimiters,
    "wrap-goal": wrapGoalData,
    "wrap-evidence": wrapEvidence,
  };
  const transform = transformers[command];
  if (!transform) usage(`unknown guard command "${command}" (see: commitai guard --help)`);

  const { values } = parse(args, {
    text: { type: "string" },
    file: { type: "string" },
  });

  const input = contentFromSources({
    text: typeof values["text"] === "string" ? values["text"] : undefined,
    file: typeof values["file"] === "string" ? values["file"] : undefined,
  });
  const output = transform(input);
  emit({ command, input, output }, global, () => output);
  return EXIT_OK;
}
