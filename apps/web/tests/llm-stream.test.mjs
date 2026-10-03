import assert from "node:assert/strict";
import test from "node:test";
import { createLLMAnswerStream } from "../src/lib/llm/answer-stream.ts";

const encoder = new TextEncoder();

function upstream(text, splitEveryByte = false) {
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      if (splitEveryByte) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      } else controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function eventsFor(text, options, splitEveryByte = false) {
  const result = await new Response(
    createLLMAnswerStream(upstream(text, splitEveryByte), options),
  ).text();
  return result
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((block) => {
      const data = block
        .split(/\r?\n/)
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trimStart();
      return data ? JSON.parse(data) : null;
    })
    .filter(Boolean);
}

test("streams only content and never exposes reasoning_content", async () => {
  const privateReasoning = "private chain of thought";
  const data =
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: privateReasoning } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: { content: "Ciao " } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: { content: "mondo" }, finish_reason: "stop" }] })}\n\n` +
    "data: [DONE]\n\n";
  const events = await eventsFor(data, {}, true);
  assert.equal(
    events
      .filter((event) => event.type === "token")
      .map((event) => event.content)
      .join(""),
    "Ciao mondo",
  );
  assert.deepEqual(events.at(-1), { type: "done" });
  assert.ok(!JSON.stringify(events).includes(privateReasoning));
});

test("reports output limits and malformed or interrupted event streams", async () => {
  const limited =
    `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" }, finish_reason: "length" }] })}\n\n` +
    "data: [DONE]\n\n";
  assert.ok(
    (await eventsFor(limited)).some((event) => event.code === "output_limit"),
  );

  assert.ok(
    (await eventsFor("data: {broken}\n\n")).some(
      (event) => event.code === "invalid_chunk",
    ),
  );
  const incomplete = `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`;
  assert.ok(
    (await eventsFor(incomplete)).some((event) => event.code === "incomplete"),
  );
});

test("reports empty output and provider errors without technical payloads", async () => {
  const empty =
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n` +
    "data: [DONE]\n\n";
  assert.ok(
    (await eventsFor(empty)).some((event) => event.code === "empty_output"),
  );
  const error = await eventsFor(
    `data: ${JSON.stringify({ error: { message: "internal error secret" } })}\n\n`,
  );
  assert.ok(error.some((event) => event.code === "provider_error"));
  assert.ok(!JSON.stringify(error).includes("internal error secret"));
});
