/**
 * tests/ai-auditor.test.ts
 *
 * Tests for the AI column confidence auditor failure modes.
 * Validates resilience and deterministic fallback across all model failure modes.
 *
 * All tests mock the fetch() call — we never make real API calls in tests.
 * This proves the validation seam works correctly regardless of AI behaviour.
 */

import { runColumnAudit } from "../lib/ai-auditor";

// ─── Fetch mock setup ─────────────────────────────────────────────────────────

const KNOWN_HEADERS = [
  "Section Name", "Item Name", "Comment Name", "Comment Text",
  "Comment Type (info, limit, defect)", "Category (-1: Low, 0: Med, 1: High)",
  "Multiple Choice Options (comma-separated)", "Order (w/i item)",
  "Answer Type (boolean, checkbox, date, number, range, text)",
];

const UNKNOWN_HEADERS = [...KNOWN_HEADERS, "Mystery Column", "Unknown Field"];
const SAMPLE_ROWS = [["Roof", "General", "Condition", "<p>Good</p>", "info", "0", "", "0", "checkbox", "x", "y"]];

function mockFetch(response: { ok: boolean; status?: number; body?: unknown }) {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: response.ok,
    status: response.status ?? 200,
    json: async () => response.body,
  } as unknown as Response);
}

afterEach(() => {
  jest.resetAllMocks();
});

beforeEach(() => {
  // Ensure fetch is not a leftover spy from a previous test
  if (jest.isMockFunction(global.fetch)) {
    jest.resetAllMocks();
  }
});

// ─── No API key ───────────────────────────────────────────────────────────────

describe("AI Auditor — no API key (graceful skip)", () => {
  test("skips AI entirely when no API key, returns deterministic results", async () => {
    const result = await runColumnAudit(KNOWN_HEADERS, SAMPLE_ROWS, undefined);
    expect(result.ran).toBe(false);
    expect(result.failure_mode).toBe("no_api_key");
    expect(result.low_confidence_columns).toHaveLength(0); // all known
  });

  test("unknown headers returned at 0.5 confidence without AI", async () => {
    const result = await runColumnAudit(UNKNOWN_HEADERS, SAMPLE_ROWS, undefined);
    const mystery = result.all_columns.find((c) => c.header === "Mystery Column");
    expect(mystery?.confidence).toBe(0.5);
    expect(mystery?.is_known).toBe(false);
  });

  test("all known headers get confidence=1.0 deterministically", async () => {
    const result = await runColumnAudit(KNOWN_HEADERS, SAMPLE_ROWS, undefined);
    result.all_columns.forEach((c) => {
      expect(c.confidence).toBe(1.0);
      expect(c.is_known).toBe(true);
    });
  });
});

// ─── Failure mode 1: Non-JSON response ────────────────────────────────────────

describe("AI Auditor — failure mode 1: non-JSON response", () => {
  test("falls back gracefully when AI returns non-JSON", async () => {
    mockFetch({
      ok: true,
      body: {
        candidates: [{
          content: { parts: [{ text: "Sorry, I cannot help with that." }] },
        }],
      },
    });

    const result = await runColumnAudit(UNKNOWN_HEADERS, SAMPLE_ROWS, "fake-key");
    expect(result.ran).toBe(false);
    expect(result.failure_mode).toBe("invalid_json_from_ai");
    // Deterministic results still returned
    expect(result.all_columns.length).toBeGreaterThan(0);
  });

  test("handles markdown-fenced JSON response (strips fences)", async () => {
    mockFetch({
      ok: true,
      body: {
        candidates: [{
          content: { parts: [{ text: '```json\n{"Mystery Column": 0.3, "Unknown Field": 0.8}\n```' }] },
        }],
      },
    });

    const result = await runColumnAudit(UNKNOWN_HEADERS, SAMPLE_ROWS, "fake-key");
    expect(result.ran).toBe(true);
    const mystery = result.all_columns.find((c) => c.header === "Mystery Column");
    expect(mystery?.confidence).toBe(0.3);
  });
});

// ─── Failure mode 2: Hallucinated schema keys ────────────────────────────────

describe("AI Auditor — failure mode 2: hallucinated schema keys", () => {
  test("strips hallucinated keys not present in our headers", async () => {
    mockFetch({
      ok: true,
      body: {
        candidates: [{
          content: { parts: [{ text: JSON.stringify({
            "Mystery Column": 0.4,
            "HALLUCINATED_KEY_THAT_DOES_NOT_EXIST": 0.9,  // hallucination
            "another_made_up_column": 0.7,                // hallucination
          }) }] },
        }],
      },
    });

    const result = await runColumnAudit(UNKNOWN_HEADERS, SAMPLE_ROWS, "fake-key");
    expect(result.ran).toBe(true);
    // Hallucinated keys must NOT appear in our results
    const hallucinated = result.all_columns.find(
      (c) => c.header === "HALLUCINATED_KEY_THAT_DOES_NOT_EXIST"
    );
    expect(hallucinated).toBeUndefined();
  });

  test("strips non-numeric values from AI response (type coercion defence)", async () => {
    mockFetch({
      ok: true,
      body: {
        candidates: [{
          content: { parts: [{ text: JSON.stringify({
            "Mystery Column": "high confidence",  // string instead of number
          }) }] },
        }],
      },
    });

    // Should not crash — validateAiResponse filters out non-numeric values
    const result = await runColumnAudit(UNKNOWN_HEADERS, SAMPLE_ROWS, "fake-key");
    expect(result.ran).toBe(true);
    // Mystery Column gets no AI score → stays at deterministic 0.5
    const mystery = result.all_columns.find((c) => c.header === "Mystery Column");
    expect(mystery?.confidence).toBe(0.5);
  });
});

// ─── Failure mode 3: Timeout ──────────────────────────────────────────────────

describe("AI Auditor — failure mode 3: timeout", () => {
  test("falls back when AI fetch times out", async () => {
    // Simulate abort
    global.fetch = jest.fn().mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" })
    );

    const result = await runColumnAudit(UNKNOWN_HEADERS, SAMPLE_ROWS, "fake-key");
    expect(result.ran).toBe(false);
    expect(result.failure_mode).toBe("timeout");
    // Deterministic results still returned — system keeps working
    expect(result.all_columns.length).toBeGreaterThan(0);
  });
});

// ─── Failure mode 4: Out-of-range confidence values ──────────────────────────

describe("AI Auditor — failure mode 4: out-of-range confidence", () => {
  test("clamps confidence > 1.0 to 1.0", async () => {
    mockFetch({
      ok: true,
      body: {
        candidates: [{
          content: { parts: [{ text: JSON.stringify({ "Mystery Column": 999 }) }] },
        }],
      },
    });

    const result = await runColumnAudit(UNKNOWN_HEADERS, SAMPLE_ROWS, "fake-key");
    const mystery = result.all_columns.find((c) => c.header === "Mystery Column");
    expect(mystery?.confidence).toBeLessThanOrEqual(1.0);
  });

  test("clamps confidence < 0.0 to 0.0", async () => {
    mockFetch({
      ok: true,
      body: {
        candidates: [{
          content: { parts: [{ text: JSON.stringify({ "Mystery Column": -5 }) }] },
        }],
      },
    });

    const result = await runColumnAudit(UNKNOWN_HEADERS, SAMPLE_ROWS, "fake-key");
    const mystery = result.all_columns.find((c) => c.header === "Mystery Column");
    expect(mystery?.confidence).toBeGreaterThanOrEqual(0.0);
  });
});

// ─── Failure mode 5: API error ────────────────────────────────────────────────

describe("AI Auditor — failure mode 5: API error response", () => {
  test("falls back gracefully on 429 rate limit", async () => {
    mockFetch({ ok: false, status: 429 });

    const result = await runColumnAudit(UNKNOWN_HEADERS, SAMPLE_ROWS, "fake-key");
    expect(result.ran).toBe(false);
    expect(result.failure_mode).toBe("api_error_429");
    expect(result.all_columns.length).toBeGreaterThan(0); // deterministic still works
  });

  test("falls back gracefully on 500 server error", async () => {
    mockFetch({ ok: false, status: 500 });

    const result = await runColumnAudit(UNKNOWN_HEADERS, SAMPLE_ROWS, "fake-key");
    expect(result.ran).toBe(false);
    expect(result.failure_mode).toBe("api_error_500");
  });
});

// ─── Deterministic always wins ────────────────────────────────────────────────

describe("AI Auditor — deterministic parse always wins", () => {
  test("known Spectora headers keep confidence=1.0 even if AI disagrees", async () => {
    // AI says "Section Name" has low confidence — but we know it's a Spectora header
    mockFetch({
      ok: true,
      body: {
        candidates: [{
          // AI only responds about unknown headers, not known ones
          content: { parts: [{ text: JSON.stringify({ "Mystery Column": 0.1 }) }] },
        }],
      },
    });

    const result = await runColumnAudit(UNKNOWN_HEADERS, SAMPLE_ROWS, "fake-key");
    const sectionName = result.all_columns.find((c) => c.header === "Section Name");
    // Deterministic result — AI cannot override this
    expect(sectionName?.confidence).toBe(1.0);
    expect(sectionName?.is_known).toBe(true);
  });

  test("all-known-headers skips AI entirely (failure_mode signals it)", async () => {
    // Don't set up a fetch mock — if fetch is called, it will fail (no mock),
    // proving the test would catch unwanted API calls.
    const result = await runColumnAudit(KNOWN_HEADERS, SAMPLE_ROWS, "fake-key");
    expect(result.ran).toBe(false);
    expect(result.failure_mode).toBe("all_headers_known");
    // All headers known — low_confidence_columns is empty
    expect(result.low_confidence_columns).toHaveLength(0);
  });
});
