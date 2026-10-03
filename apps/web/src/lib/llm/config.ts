export type LLMConfig = {
  baseUrl: URL;
  model: string;
  apiKey: string;
  contextSize: number;
  enableThinking: boolean;
};

const defaultBaseUrl = "http://127.0.0.1:8888/v1";
const defaultModel = "unsloth/Qwen3.5-2B-GGUF";

export function getLLMConfig(): LLMConfig {
  let baseUrl: URL;
  try {
    baseUrl = new URL(process.env.LLM_BASE_URL?.trim() || defaultBaseUrl);
  } catch {
    throw new Error("LLM_BASE_URL non contiene un indirizzo valido.");
  }

  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (
    baseUrl.protocol !== "http:" ||
    !loopbackHosts.has(baseUrl.hostname) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error(
      "Per sicurezza, llama.cpp deve usare un indirizzo HTTP locale.",
    );
  }

  const model = process.env.LLM_MODEL?.trim() || defaultModel;
  if (!model) throw new Error("LLM_MODEL non può essere vuoto.");

  const configuredContextSize = Number(process.env.LLM_CONTEXT_SIZE || 8192);
  if (
    !Number.isSafeInteger(configuredContextSize) ||
    configuredContextSize < 1024 ||
    configuredContextSize > 262_144
  ) {
    throw new Error("LLM_CONTEXT_SIZE deve essere compreso tra 1024 e 262144.");
  }

  const thinkingSetting = process.env.LLM_ENABLE_THINKING?.trim().toLowerCase();
  if (
    thinkingSetting &&
    thinkingSetting !== "true" &&
    thinkingSetting !== "false"
  )
    throw new Error("LLM_ENABLE_THINKING deve essere true o false.");

  return {
    baseUrl,
    model,
    apiKey: process.env.LLM_API_KEY?.trim() || "local",
    contextSize: configuredContextSize,
    enableThinking: thinkingSetting === "true",
  };
}
