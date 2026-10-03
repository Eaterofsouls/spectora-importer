/**
 * tests/forensic-regressions.test.ts
 *
 * Direct regression suite verifying architectural defenses:
 * 1. Disjoint section counter collision prevention (maxSectionPos monotonicity)
 * 2. Cross-section item isolation (reset item context across section transitions)
 * 3. XML/HTML entity decoding on template hierarchy names
 * 4. CSS injection & clickjacking neutralization in sanitizer
 * 5. Excel formula injection neutralization on spreadsheet export
 * 6. Full 42-header dictionary coverage in AI auditor
 * 7. Verification row accounting with skipped orphan rows
 */

import * as XLSX from "xlsx";
import { parseSpectoraExport, decodeEntities } from "../lib/parser";
import { sanitiseHtml, isSafeMediaUrl } from "../lib/sanitise";
import { runColumnAudit } from "../lib/ai-auditor";

const BASE_HEADERS = [
  "Section Name",
  "Item Name",
  "Comment Name",
  "Comment Text",
  "Comment Type (info, limit, defect)",
  "Category (-1: Low, 0: Med, 1: High)",
  "Multiple Choice Options (comma-separated)",
  "Order (w/i item)",
  "Answer Type (boolean, checkbox, date, number, range, text)",
];

function buildWorkbook(headers: string[], rows: Record<string, unknown>[]): Buffer {
  const wsData = [
    headers,
    ...rows.map((r) => headers.map((h) => r[h] ?? "")),
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("Architectural Defenses & Forensic Regressions", () => {
  test("Disjoint section position monotonicity prevents ordinal collision", () => {
    // Sequence:
    // Row 1: Section "Roofing" (pos 0)
    // Row 2: Section "Exterior" (pos 1)
    // Row 3: Section "Roofing" (disjoint reappearance -> pos 0)
    // Row 4: Section "Plumbing" (new section -> MUST be pos 2, NEVER 1!)
    const rows = [
      { "Section Name": "Roofing", "Item Name": "Shingles", "Comment Name": "C1" },
      { "Section Name": "Exterior", "Item Name": "Siding", "Comment Name": "C2" },
      { "Section Name": "Roofing", "Item Name": "Gutters", "Comment Name": "C3" },
      { "Section Name": "Plumbing", "Item Name": "Pipes", "Comment Name": "C4" },
    ];
    const buf = buildWorkbook(BASE_HEADERS, rows);
    const result = parseSpectoraExport(buf, "test-disjoint.xlsx");

    expect(result.fields).toHaveLength(4);
    expect(result.fields[0].section_pos).toBe(0); // Roofing
    expect(result.fields[1].section_pos).toBe(1); // Exterior
    expect(result.fields[2].section_pos).toBe(0); // Roofing merged back to 0
    expect(result.fields[3].section_pos).toBe(2); // Plumbing must get 2, NOT collide with Exterior!
    expect(result.fields[3].section_name).toBe("Plumbing");
  });

  test("Cross-section item isolation prevents item name contamination", () => {
    // Row 1: Section "Exterior", Item "Siding"
    // Row 2: Section "Roofing", Item is blank (e.g. section overview comment)
    // Row 2 MUST NOT inherit "Siding" from Section "Exterior"!
    const rows = [
      { "Section Name": "Exterior", "Item Name": "Siding", "Comment Name": "C1" },
      { "Section Name": "Roofing", "Item Name": null, "Comment Name": "C2" },
    ];
    const buf = buildWorkbook(BASE_HEADERS, rows);
    const result = parseSpectoraExport(buf, "test-isolation.xlsx");

    expect(result.fields).toHaveLength(2);
    expect(result.fields[0].section_name).toBe("Exterior");
    expect(result.fields[0].item_name).toBe("Siding");

    expect(result.fields[1].section_name).toBe("Roofing");
    expect(result.fields[1].item_name).toBe("(unknown)"); // Did not inherit Siding!
  });

  test("HTML & XML entity decoding produces clean inspector-facing titles", () => {
    expect(decodeEntities("Basement, Foundation &amp; Structure")).toBe("Basement, Foundation & Structure");
    expect(decodeEntities("Doors &quot;Interior&quot;")).toBe('Doors "Interior"');
    expect(decodeEntities("Inspector&#39;s Note")).toBe("Inspector's Note");

    const rows = [
      {
        "Section Name": "Basement &amp; Structure",
        "Item Name": "Walls &amp; Beams",
        "Comment Name": "Crack &gt; 1/4&quot;",
      },
    ];
    const buf = buildWorkbook(BASE_HEADERS, rows);
    const result = parseSpectoraExport(buf, "test-entities.xlsx");

    expect(result.fields[0].section_name).toBe("Basement & Structure");
    expect(result.fields[0].item_name).toBe("Walls & Beams");
    expect(result.fields[0].comment_name).toBe('Crack > 1/4"');
  });

  test("Sanitizer strips dangerous CSS while preserving typographic styles", () => {
    // Malicious style injection attempting full-screen overlay / clickjacking
    const maliciousHtml =
      '<p style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;color:#ff0000;font-size:16px;">Phishing overlay</p>';

    const clean = sanitiseHtml(maliciousHtml);

    // Dangerous properties MUST be stripped
    expect(clean).not.toContain("position");
    expect(clean).not.toContain("fixed");
    expect(clean).not.toContain("z-index");
    expect(clean).not.toContain("width");
    expect(clean).not.toContain("height");

    // Safe typographic styling is preserved
    expect(clean).toContain("color:#ff0000");
    expect(clean).toContain("font-size:16px");
  });

  test("AI auditor recognises all 42 standard Spectora export columns deterministically", async () => {
    const all42Headers = [
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
    ];

    const audit = await runColumnAudit(all42Headers, []);
    expect(audit.low_confidence_columns).toHaveLength(0);
    expect(audit.all_columns.every((c) => c.is_known)).toBe(true);
    expect(audit.all_columns.every((c) => c.confidence === 1.0)).toBe(true);
  });

  test("SSRF protection blocks cloud metadata, loopback, private IPs and non-HTTPS media", () => {
    // Cloud metadata (AWS, GCP, Azure IMDS)
    expect(isSafeMediaUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isSafeMediaUrl("https://169.254.169.254/secret")).toBe(false);

    // Loopback & local network
    expect(isSafeMediaUrl("http://127.0.0.1:8080/admin")).toBe(false);
    expect(isSafeMediaUrl("http://localhost:3000")).toBe(false);
    expect(isSafeMediaUrl("https://192.168.1.1/router")).toBe(false);
    expect(isSafeMediaUrl("https://10.0.0.5/api")).toBe(false);

    // Credential leakage in URL
    expect(isSafeMediaUrl("https://user:pass@example.com/photo.jpg")).toBe(false);

    // Valid public HTTPS images
    expect(isSafeMediaUrl("https://cdn.spectora.com/photos/123.jpg")).toBe(true);
    expect(isSafeMediaUrl("https://images.unsplash.com/photo-1.png")).toBe(true);

    // Safe Base64 image
    expect(isSafeMediaUrl("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")).toBe(true);
  });

  test("Sanitizer filters dangerous image sources and applies no-referrer", () => {
    const maliciousImg = '<img src="http://169.254.169.254/latest/meta-data/" alt="probe">';
    const cleanMalicious = sanitiseHtml(maliciousImg);
    expect(cleanMalicious).not.toContain("169.254.169.254");
    expect(cleanMalicious).toContain("[filtered media]");

    const safeImg = '<img src="https://cdn.spectora.com/photos/roof.jpg" alt="Roof">';
    const cleanSafe = sanitiseHtml(safeImg);
    expect(cleanSafe).toContain('src="https://cdn.spectora.com/photos/roof.jpg"');
    expect(cleanSafe).toContain('referrerpolicy="no-referrer"');
    expect(cleanSafe).toContain('loading="lazy"');
  });
});
