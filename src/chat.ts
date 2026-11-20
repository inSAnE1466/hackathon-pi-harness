import { env } from "cloudflare:workers";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  configure,
  createRegistry,
  defineExtension,
  section,
  type HarnessOptions,
} from "@earendil-works/pi-durable";
import { DeliverScheduledInstruction } from "./schedule.ts";
import { conversationSearchExtension, searchHistoryTool } from "./search.ts";
import { getWeatherTool, scheduleTool } from "./tools.ts";
import { BRANE_CLOUD_MODEL, BRANE_PROVIDER, braneProvider, type BraneDecision } from "./brane.ts";

/** Application-owned agent composition. BRANE is the only model provider; there is no other route to a model. */
export function createChatHarnessOptions(
  onDecision: (decision: BraneDecision) => void = () => {},
): HarnessOptions {
  const models = createModels();
  models.setProvider(braneProvider(env, onDecision));
  const chatExtension = defineExtension({
    name: "chat",
    tasks: [DeliverScheduledInstruction],
    tools: [getWeatherTool, scheduleTool, searchHistoryTool],
    sections: [
      section(
        "preamble",
        () =>
          "You are a concise assistant. User messages may begin with a display name in brackets; treat it as speaker attribution.",
        { tag: false },
      ),
      section(
        "clock",
        // Minute precision: finer values would append a system-prompt delta on every request.
        () => `Current time: ${new Date().toISOString().slice(0, 16)}Z.`,
        { tag: false },
      ),
    ],
  });
  const registry = createRegistry();
  registry.install(chatExtension);
  registry.install(conversationSearchExtension);
  const defaultAgent = {
    model: { provider: BRANE_PROVIDER, modelId: BRANE_CLOUD_MODEL },
    thinkingLevel: "off" as const,
    tools: [getWeatherTool, scheduleTool, searchHistoryTool],
  };

  return {
    models,
    registry,
    settings: { extensions: [chatExtension] },
    conversationCreated: (tx, conversation) =>
      conversation.owner === undefined && conversation.parent === undefined
        ? configure(tx, conversation.id, defaultAgent)
        : undefined,
  };
}
