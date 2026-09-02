import type { ProviderClient, ProviderConfig } from "../types.js";
import { MockProviderClient } from "./mock.js";
import { OllamaClient } from "./ollama.js";
import { OpenAiCompatibleClient } from "./openaiCompatible.js";

export function createProviderClient(config: ProviderConfig): ProviderClient {
  switch (config.kind) {
    case "ollama":
      return new OllamaClient(config);
    case "openai-compatible":
      return new OpenAiCompatibleClient(config);
    case "mock":
      return new MockProviderClient(config);
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`unknown provider kind: ${String(exhaustive)}`);
    }
  }
}
