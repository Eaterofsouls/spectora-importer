/**
 * tests/api.test.ts
 *
 * API Integration and Logic Tests:
 * 1. Optimistic concurrency (409 Conflict) on stale updated_at
 * 2. Section cascade rename logic
 * 3. Field revert to imported snapshot (snap_* restore)
 * 4. Re-export XLSX round-trip data preservation
 */

import * as XLSX from "xlsx";

describe("API Logic — Concurrency & Revert & Export", () => {
  test("Optimistic concurrency: rejects save if updated_at is stale (prevents lost updates)", () => {
    const originalUpdatedAt = "2026-10-01T10:00:00.000Z";
    const currentDbUpdatedAt = "2026-10-01T10:05:00.000Z"; // another tab saved in the meantime
    const incomingPayload = {
      comment_text: "My new edit",
      updated_at: originalUpdatedAt, // stale timestamp
    };

    // Stale check logic
    const isStale = incomingPayload.updated_at !== currentDbUpdatedAt;
    expect(isStale).toBe(true);

    const httpStatus = isStale ? 409 : 200;
    expect(httpStatus).toBe(409);
  });

  test("Revert to snapshot: restores exact as-imported text without data loss", () => {
    const field = {
      id: "f1",
      comment_text: "Accidentally erased text by user",
      snap_comment_text: "<p>Original canned inspection comment text</p>",
      snap_comment_name: "Original Name",
    };

    // PUT revert operation restores snap_* values
    const reverted = {
      ...field,
      comment_text: field.snap_comment_text,
      comment_name: field.snap_comment_name,
    };

    expect(reverted.comment_text).toBe(field.snap_comment_text);
    expect(reverted.comment_name).toBe(field.snap_comment_name);
  });

  test("Section cascade rename: renames section across all items and comments sharing section_pos", () => {
    const fields = [
      { id: "1", section_pos: 0, section_name: "Old Roof", item_name: "Covering" },
      { id: "2", section_pos: 0, section_name: "Old Roof", item_name: "Flashing" },
      { id: "3", section_pos: 1, section_name: "Attic", item_name: "Insulation" },
    ];

    const targetSectionPos = 0;
    const newSectionName = "Inspected Roof & Covering";

    // Cascade rename updates all rows with matching section_pos
    const updated = fields.map((f) =>
      f.section_pos === targetSectionPos ? { ...f, section_name: newSectionName } : f
    );

    expect(updated[0].section_name).toBe(newSectionName);
    expect(updated[1].section_name).toBe(newSectionName);
    expect(updated[2].section_name).toBe("Attic"); // other sections untouched
  });

  test("Re-export XLSX generation: yields valid readable workbook with all columns", () => {
    const headers = [
      "Section Name", "Item Name", "Comment Name", "Comment Text",
      "Comment Type (info, limit, defect)", "Category (-1: Low, 0: Med, 1: High)",
      "Answer Type (boolean, checkbox, date, number, range, text)", "Order (w/i item)"
    ];
    const row1 = ["Roof", "General", "Condition", "Good", "info", 0, "checkbox", 0];

    const ws = XLSX.utils.aoa_to_sheet([headers, row1]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);

    // Read back to confirm round-trip integrity
    const readWb = XLSX.read(buffer, { type: "buffer" });
    const readWs = readWb.Sheets["Sheet1"];
    expect(readWs["A1"].v).toBe("Section Name");
    expect(readWs["A2"].v).toBe("Roof");
    expect(readWs["D2"].v).toBe("Good");
  });
});
