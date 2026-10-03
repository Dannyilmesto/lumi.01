import assert from "node:assert/strict";
import test from "node:test";
import { getLLMConfig } from "../src/lib/llm/config.ts";
import {
  fitMessagesToContext,
  LLMContextError,
} from "../src/lib/llm/context-manager.ts";
import { LlamaCppProvider } from "../src/lib/llm/llama-cpp-provider.ts";

function config(baseUrl = "http://127.0.0.1:8080/v1") {
  return {
    baseUrl: new URL(baseUrl),
    model: "unsloth/Qwen3.5-2B-GGUF",
    apiKey: "local",
    contextSize: 8192,
    enableThinking: false,
  };
}

function env(t, name, value) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

test("defaults to the configured loopback llama.cpp model", (t) => {
  env(t, "LLM_BASE_URL", undefined);
  env(t, "LLM_MODEL", undefined);
  env(t, "LLM_API_KEY", undefined);
  env(t, "LLM_CONTEXT_SIZE", undefined);
  env(t, "LLM_ENABLE_THINKING", undefined);
  const result = getLLMConfig();
  assert.equal(result.baseUrl.href, "http://127.0.0.1:8888/v1");
  assert.equal(result.model, "unsloth/Qwen3.5-2B-GGUF");
  assert.equal(result.apiKey, "local");
  assert.equal(result.contextSize, 8192);
  assert.equal(result.enableThinking, false);
});

test("rejects non-loopback URLs, credentials, query strings and invalid contexts", (t) => {
  for (const url of [
    "https://127.0.0.1:8080/v1",
    "http://example.com/v1",
    "http://user:pass@127.0.0.1:8080/v1",
    "http://127.0.0.1:8080/v1?proxy=1",
  ]) {
    env(t, "LLM_BASE_URL", url);
    assert.throws(() => getLLMConfig());
  }
  env(t, "LLM_BASE_URL", "http://127.0.0.1:8080/v1");
  env(t, "LLM_CONTEXT_SIZE", "512");
  assert.throws(() => getLLMConfig(), /LLM_CONTEXT_SIZE/);
});

test("sends OpenAI-compatible roles, JSON schema and image content", async () => {
  let request;
  const provider = new LlamaCppProvider(config(), async (url, options) => {
    assert.equal(url.toString(), "http://127.0.0.1:8080/v1/chat/completions");
    assert.match(options.headers.Authorization, /^Bearer .+/);
    request = JSON.parse(options.body);
    return Response.json({
      choices: [
        {
          message: {
            role: "assistant",
            content: '{"ok":true}',
            reasoning_content: "Never expose this.",
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    });
  });
  const result = await provider.chat({
    temperature: 0,
    maxTokens: 100,
    responseFormat: {
      type: "json_schema",
      json_schema: { name: "test", strict: true, schema: { type: "object" } },
    },
    messages: [
      { role: "system", content: "rules" },
      { role: "user", content: "question" },
      {
        role: "user",
        content: [
          { type: "text", text: "with image" },
          {
            type: "image_url",
            image_url: { url: "data:image/jpeg;base64,AA==" },
          },
        ],
      },
    ],
  });
  assert.equal(request.model, "unsloth/Qwen3.5-2B-GGUF");
  assert.equal(request.stream, false);
  assert.equal(request.chat_template_kwargs, undefined);
  assert.equal(request.options, undefined);
  assert.equal(request.messages[0].role, "system");
  assert.equal(request.messages[1].role, "user");
  assert.equal(request.response_format.json_schema.name, "test");
  assert.equal(
    request.messages[2].content[1].image_url.url,
    "data:image/jpeg;base64,AA==",
  );
  assert.equal(result.content, '{"ok":true}');
  assert.deepEqual(result.toolCalls, []);
  assert.deepEqual(result.usage, {
    promptTokens: 12,
    completionTokens: 4,
    totalTokens: 16,
  });
  assert.ok(!JSON.stringify(result).includes("Never expose this."));
});

test("sends Ollama-specific context and thinking options only to Ollama", async () => {
  let request;
  const provider = new LlamaCppProvider(
    config("http://127.0.0.1:11434/v1"),
    async (_url, options) => {
      request = JSON.parse(options.body);
      return Response.json({
        choices: [{ message: { role: "assistant", content: "Risposta" } }],
      });
    },
  );
  await provider.chat({
    messages: [{ role: "user", content: "Domanda" }],
    maxTokens: 50,
  });
  assert.deepEqual(request.options, {
    num_ctx: 8192,
    num_predict: 50,
    think: false,
  });
  assert.equal(request.chat_template_kwargs, undefined);
});

test("parses OpenAI-compatible tool calls and tool response roles", async () => {
  let request;
  const provider = new LlamaCppProvider(config(), async (_url, options) => {
    request = JSON.parse(options.body);
    return Response.json({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "search", arguments: '{"query":"x"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
  });
  const result = await provider.chat({
    tools: [
      {
        type: "function",
        function: { name: "search", parameters: { type: "object" } },
      },
    ],
    messages: [
      { role: "user", content: "search" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "search", arguments: '{"query":"x"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: '{"items":[]}' },
    ],
  });
  assert.equal(request.messages[2].role, "tool");
  assert.equal(request.messages[2].tool_call_id, "call_1");
  assert.equal(request.tools[0].function.name, "search");
  assert.equal(result.toolCalls[0].function.name, "search");
});

test("maps connection failures, context overflow, missing models and invalid JSON safely", async () => {
  const unreachable = new LlamaCppProvider(config(), async () => {
    throw new Error("ECONNREFUSED technical detail");
  });
  await assert.rejects(
    unreachable.chat({ messages: [{ role: "user", content: "hello" }] }),
    (error) =>
      error.statusCode === 503 &&
      error.message.includes("Verifica che llama.cpp sia avviato") &&
      !error.message.includes("ECONNREFUSED"),
  );

  for (const [status, detail, expectedCode] of [
    [400, "context size exceeded", "context_length"],
    [404, "model not found", "model_unavailable"],
  ]) {
    const provider = new LlamaCppProvider(config(), async () =>
      Response.json({ error: { message: detail } }, { status }),
    );
    await assert.rejects(
      provider.chat({ messages: [{ role: "user", content: "hello" }] }),
      (error) => error.code === expectedCode,
    );
  }

  const invalidJson = new LlamaCppProvider(
    config(),
    async () => new Response("not JSON", { status: 200 }),
  );
  await assert.rejects(
    invalidJson.chat({ messages: [{ role: "user", content: "hello" }] }),
    (error) => error.code === "invalid_json" && error.statusCode === 502,
  );
});

test("context manager drops oldest turns, keeps system and current request, and rejects oversized prompts", () => {
  const oldTurn = { role: "user", content: "x".repeat(2400) };
  const messages = [
    { role: "system", content: "system rules" },
    oldTurn,
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "old-call",
          type: "function",
          function: { name: "old_tool", arguments: "{}" },
        },
      ],
    },
    { role: "tool", tool_call_id: "old-call", content: "old result" },
    { role: "assistant", content: "old answer" },
    { role: "user", content: "latest request" },
  ];
  const fitted = fitMessagesToContext(messages, {
    contextSize: 1150,
    maxOutputTokens: 200,
  });
  assert.equal(fitted[0].role, "system");
  assert.equal(fitted.at(-1).content, "latest request");
  assert.ok(!fitted.includes(oldTurn));
  assert.ok(!fitted.some((message) => message.role === "tool"));
  assert.ok(!fitted.some((message) => message.tool_calls));
  assert.throws(
    () =>
      fitMessagesToContext(
        [
          { role: "system", content: "rules" },
          { role: "user", content: "x".repeat(30_000) },
        ],
        { contextSize: 8192, maxOutputTokens: 1000 },
      ),
    LLMContextError,
  );
});

test("health checks the local model list and reports unavailable models", async () => {
  const provider = new LlamaCppProvider(
    config("http://127.0.0.1:8888/v1"),
    async (url) => {
    assert.equal(url.toString(), "http://127.0.0.1:8888/v1/models");
    return Response.json({
      data: [{ id: "unsloth/Qwen3.5-2B-GGUF" }],
      },
    );
  });
  assert.deepEqual(await provider.health(), {
    available: true,
    model: "unsloth/Qwen3.5-2B-GGUF",
  });
  const missing = new LlamaCppProvider(
    config("http://127.0.0.1:8888/v1"),
    async () => Response.json({ data: [{ id: "other-model" }] }),
  );
  assert.deepEqual(await missing.health(), {
    available: false,
    model: "unsloth/Qwen3.5-2B-GGUF",
    error: "Il modello configurato non è caricato in llama.cpp.",
  });
});
