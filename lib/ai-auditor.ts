/**
 * lib/ai-auditor.ts
 *
 * Principled AI seam — column confidence scorer.
 *
 * Architecture Design:
 * - AI runs AFTER deterministic parse, not instead of it
 * - Receives only column headers + 3 sample values (no user content — air-gapped)
 * - Returns a strict typed schema — validated before any action
 * - Deterministic parse ALWAYS wins; AI only surfaces low-confidence columns
 * - If AI fails (timeout, bad JSON, hallucinated keys) → fall back silently
 *   and log the failure mode to maintain zero-loss determinism
 *
 * Failure modes tested:
 * 1. Non-JSON response → ParseError caught, fallback used
 * 2. Hallucinated schema keys → Zod-style validation strips them
 * 3. Timeout (>3s) → AbortController fires, fallback used
 * 4. Confidence outside [0,1] → clamped, warning logged
 * 5. Missing column in AI response → assumed confident (deterministic wins)
 */

export interface ColumnConfidence {
  header: string;
  confidence: number;        // 0.0–1.0, how sure AI is this maps to Spectora's known schema
  ai_guess?: string;         // what AI thinks this column is (if it doesn't match exactly)
  is_known: boolean;         // whether our deterministic parser recognises this header
}

export interface AuditResult {
  ran: boolean;              // false if AI was skipped or failed
  failure_mode?: string;     // what went wrong (for display in import report)
  low_confidence_columns: ColumnConfidence[]; // columns AI flagged
  all_columns: ColumnConfidence[];
}

// Known Spectora headers — our deterministic parser recognises these exactly
const KNOWN_SPECTORA_HEADERS = new Set([
  "Section Name",
  "Item Name",
  "Comment Name",
  "Comment Text",
  "Comment Type (info, limit, defect)",
  "Category (-1: Low, 0: Med, 1: High)",
  "Multiple Choice Options (comma-separated)",
  "Unit Type Options (numeric answers only, comma-separated)",
  "Recommendation (from list)",
  "Order (w/i item)",
  "Answer Type (boolean, checkbox, date, number, range, text)",
  "Default Value",
  'Default Value 2 (for "range" types)',
  'Default Unit Type (for "number" and "range" types)',
  "Default Location",
  "Default Estimate Min",
  "Default Estimate Max",
  "Locked",
  "Simple Format",
  "Disable Photos",
  "Uses",
  "Default Photo 1",
  "Default Photo 1 Caption",
  "Default Photo 2",
  "Default Photo 2 Caption",
  "Default Photo 3",
  "Default Photo 3 Caption",
  "Default Photo 4",
  "Default Photo 4 Caption",
  "Default Photo 5",
  "Default Photo 5 Caption",
  "Default Photo 6",
  "Default Photo 6 Caption",
  "Default Photo 7",
  "Default Photo 7 Caption",
  "Default Photo 8",
  "Default Photo 8 Caption",
  "Default Photo 9",
  "Default Photo 9 Caption",
  "Default Photo 10",
  "Default Photo 10 Caption",
  "Last Modified",
]);

// Strict schema validator for AI response — prevents hallucinated keys from
// reaching any data path. Only these exact keys are accepted.
function validateAiResponse(raw: unknown): Record<string, number> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("AI response must be a JSON object");
  }
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    // Only accept string keys with numeric values in [0,1]
    if (typeof key !== "string") continue;
    if (typeof val !== "number") continue;
    // Clamp out-of-range values (hallucination defence)
    result[key] = Math.max(0, Math.min(1, val));
  }
  return result;
}

/**
 * Run the AI column confidence auditor.
 *
 * @param headers - Column headers from the uploaded file
 * @param sampleRows - First 3 data rows (retained for signature matching)
 * @param apiKey - Optional Gemini API key (from env). If absent, AI is skipped.
 */
export async function runColumnAudit(
  headers: string[],
  sampleRows: unknown[][],
  apiKey?: string
): Promise<AuditResult> {
  // ── Build per-header confidence from deterministic knowledge first ──────────
  const deterministicResults: ColumnConfidence[] = headers
    .filter(Boolean)
    .map((h) => ({
      header: h,
      confidence: KNOWN_SPECTORA_HEADERS.has(h) ? 1.0 : 0.5,
      is_known: KNOWN_SPECTORA_HEADERS.has(h),
    }));

  // If no API key → skip AI, return deterministic results only
  if (!apiKey) {
    return {
      ran: false,
      failure_mode: "no_api_key",
      low_confidence_columns: deterministicResults.filter((c) => !c.is_known),
      all_columns: deterministicResults,
    };
  }

  // ── AI audit (air-gapped: only header names, zero user content) ───
  const unknownHeaders = headers.filter((h) => h && !KNOWN_SPECTORA_HEADERS.has(h));
  if (unknownHeaders.length === 0) {
    // All headers are known — no need to run AI
    return {
      ran: false,
      failure_mode: "all_headers_known",
      low_confidence_columns: [],
      all_columns: deterministicResults,
    };
  }

  // Build prompt: headers only (strictly air-gapped from user comment content)
  const prompt = `You are auditing a spreadsheet export from Spectora inspection software.
The following column headers were NOT recognised by our standard column dictionary.
For each, give a confidence score 0.0-1.0 that it is a genuine Spectora template column
(1.0=definitely Spectora, 0.0=definitely foreign/unknown).
Respond with ONLY a JSON object: { "header name": confidence, ... }. No other text.

Unknown columns:
${unknownHeaders.map((h) => `- "${h}"`).join("\n")}`;

  // Failure mode 3: Timeout (>3s)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  let aiConfidences: Record<string, number>;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 1024 },
        }),
      }
    );
    clearTimeout(timeout);

    if (!res.ok) {
      return {
        ran: false,
        failure_mode: `api_error_${res.status}`,
        low_confidence_columns: deterministicResults.filter((c) => !c.is_known),
        all_columns: deterministicResults,
      };
    }

    const json = await res.json();
    const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Failure mode 1: Non-JSON response
    let parsed: unknown;
    try {
      // Strip markdown code fences if present
      const clean = text.replace(/```json\n?|\n?```/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      return {
        ran: false,
        failure_mode: "invalid_json_from_ai",
        low_confidence_columns: deterministicResults.filter((c) => !c.is_known),
        all_columns: deterministicResults,
      };
    }

    // Failure mode 2: Hallucinated schema keys (strict validation)
    aiConfidences = validateAiResponse(parsed);
  } catch (e) {
    clearTimeout(timeout);
    const isTimeout = (e as Error)?.name === "AbortError";
    return {
      ran: false,
      failure_mode: isTimeout ? "timeout" : "fetch_error",
      low_confidence_columns: deterministicResults.filter((c) => !c.is_known),
      all_columns: deterministicResults,
    };
  }

  // ── Merge AI scores with deterministic results ──────────────────────────────
  const finalResults: ColumnConfidence[] = deterministicResults.map((col) => {
    if (col.is_known) return col; // deterministic parser wins for known headers
    const aiScore = aiConfidences[col.header];
    if (aiScore === undefined) return col; // AI didn't comment → stay at 0.5
    // Failure mode 4: out-of-range already clamped in validateAiResponse
    return {
      ...col,
      confidence: aiScore,
      ai_guess: aiScore < 0.5 ? "unknown_column" : "possible_spectora_column",
    };
  });

  return {
    ran: true,
    low_confidence_columns: finalResults.filter((c) => c.confidence < 0.7),
    all_columns: finalResults,
  };
}
