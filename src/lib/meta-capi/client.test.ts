import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { sendCapiEvents } from "./client.ts";
import { buildMetaCapiEvent } from "./event.ts";

const originalVersion = process.env.META_GRAPH_API_VERSION;

afterEach(() => {
  if (originalVersion == null) {
    delete process.env.META_GRAPH_API_VERSION;
  } else {
    process.env.META_GRAPH_API_VERSION = originalVersion;
  }
});

function makeEvent() {
  return buildMetaCapiEvent({
    eventName: "Lead",
    eventTimeMs: 1_780_000_000_000,
    eventId: "stable-event-id",
    user: { external_id: "contact-1" },
  });
}

describe("sendCapiEvents", () => {
  it("uses the current Meta Graph version by default", async () => {
    delete process.env.META_GRAPH_API_VERSION;
    let capturedUrl = "";

    const fakeFetch: typeof fetch = async (input) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ events_received: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await sendCapiEvents(
      { pixelId: "123456789", accessToken: "token", events: [makeEvent()] },
      fakeFetch,
    );

    assert.match(capturedUrl, /\/v26\.0\/123456789\/events$/);
  });

  it("omits test_event_code from production calls and honors configured Graph version", async () => {
    process.env.META_GRAPH_API_VERSION = "v25.0";
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    let hasAbortSignal = false;

    const fakeFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      hasAbortSignal = Boolean(init?.signal);
      return new Response(
        JSON.stringify({ events_received: 1, fbtrace_id: "trace-1" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const result = await sendCapiEvents(
      {
        pixelId: "123456789",
        accessToken: "token",
        events: [makeEvent()],
      },
      fakeFetch,
    );

    assert.equal(result.ok, true);
    assert.equal(result.eventsReceived, 1);
    assert.match(capturedUrl, /\/v25\.0\/123456789\/events$/);
    assert.equal(capturedBody.test_event_code, undefined);
    assert.equal(hasAbortSignal, true);
  });

  it("includes test_event_code only when explicitly requested", async () => {
    let capturedBody: Record<string, unknown> = {};

    const fakeFetch: typeof fetch = async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ events_received: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await sendCapiEvents(
      {
        pixelId: "123456789",
        accessToken: "token",
        events: [makeEvent()],
        testEventCode: "TEST123",
      },
      fakeFetch,
    );

    assert.equal(capturedBody.test_event_code, "TEST123");
  });
});
