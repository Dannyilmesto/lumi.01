export type LLMTextPart = { type: "text"; text: string };
export type LLMImagePart = {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
};
export type LLMMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<LLMTextPart | LLMImagePart> | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};
export type LLMTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};
export type LLMResponseFormat = {
  type: "json_schema";
  json_schema: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
};
export type LLMRequestOptions = {
  messages: LLMMessage[];
  signal?: AbortSignal;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  tools?: LLMTool[];
  responseFormat?: LLMResponseFormat;
};
export type LLMChatResult = {
  content: string;
  toolCalls: NonNullable<LLMMessage["tool_calls"]>;
  finishReason: string | null;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

export interface LLMProvider {
  readonly model: string;
  chat(request: LLMRequestOptions): Promise<LLMChatResult>;
  streamChat(request: LLMRequestOptions): Promise<ReadableStream<Uint8Array>>;
  health(signal?: AbortSignal): Promise<{
    available: boolean;
    model: string;
    error?: string;
  }>;
}

export class LLMProviderError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.statusCode = statusCode;
    this.code = code;
  }
}
