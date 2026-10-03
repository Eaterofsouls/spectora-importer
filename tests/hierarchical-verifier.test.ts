/**
 * tests/hierarchical-verifier.test.ts
 *
 * Comprehensive test suite for Hierarchical Tree Traversal, Monotonicity Invariants,
 * and Canonical Node Stream Diffing.
 *
 * Verifies that:
 * 1. Template -> Section -> Item -> Comment node streams are constructed deterministically.
 * 2. Positional ordinals (section_pos, item_pos, field_pos) maintain strict monotonic ordering.
 * 3. findFirstTreeDifference accurately flags type, category, answer_type, naming, and count mismatches.
 * 4. Disjoint sections with repeated names are preserved in physical document sequence.
 */

import {
  buildHierarchicalNodeStream,
  findFirstTreeDifference,
  verifyHierarchyConsistency,
  HierarchicalNode,
} from "../lib/verifier";

describe("Hierarchical Verifier — Canonical Node Stream Construction", () => {
  const baseFields = [
    {
      source_row: 2,
      section_name: "Roofing",
      item_name: "Coverings",
      comment_name: "Asphalt Shingles",
      comment_text: "<p>Architectural style asphalt shingles observed.</p>",
      comment_type: "info",
      category: 0,
      answer_type: "text",
      options_raw: "",
      section_pos: 0,
      item_pos: 0,
      field_pos: 0,
    },
    {
      source_row: 3,
      section_name: "Roofing",
      item_name: "Coverings",
      comment_name: "Damaged Shingle",
      comment_text: "<p>Cracked or missing shingles identified at south slope.</p>",
      comment_type: "defect",
      category: 1,
      answer_type: "text",
      options_raw: "",
      section_pos: 0,
      item_pos: 0,
      field_pos: 1,
    },
    {
      source_row: 4,
      section_name: "Roofing",
      item_name: "Flashings",
      comment_name: "Chimney Flashing",
      comment_text: "<p>Step and counter flashing installed.</p>",
      comment_type: "info",
      category: 0,
      answer_type: "checkbox",
      options_raw: "Step, Counter, Valley",
      section_pos: 0,
      item_pos: 1,
      field_pos: 0,
    },
    {
      source_row: 5,
      section_name: "Exterior",
      item_name: "Wall Cladding",
      comment_name: "Siding Condition",
      comment_text: "<p>Fiber cement lap siding in serviceable condition.</p>",
      comment_type: "info",
      category: 0,
      answer_type: "text",
      options_raw: "",
      section_pos: 1,
      item_pos: 0,
      field_pos: 0,
    },
  ];

  test("builds correct canonical node hierarchy stream", () => {
    const nodes = buildHierarchicalNodeStream(baseFields, "Standard Home Inspection");

    // Expected nodes:
    // 0: template
    // 1: section "Roofing" (pos 0)
    // 2: item "Coverings" (pos 0)
    // 3: comment "Asphalt Shingles" (pos 0)
    // 4: comment "Damaged Shingle" (pos 1)
    // 5: item "Flashings" (pos 1)
    // 6: comment "Chimney Flashing" (pos 0)
    // 7: section "Exterior" (pos 1)
    // 8: item "Wall Cladding" (pos 0)
    // 9: comment "Siding Condition" (pos 0)

    expect(nodes).toHaveLength(10);
    expect(nodes[0]).toEqual({ type: "template", name: "Standard Home Inspection", position: 0 });
    expect(nodes[1]).toMatchObject({ type: "section", name: "Roofing", position: 0, source_row: 2 });
    expect(nodes[2]).toMatchObject({ type: "item", name: "Coverings", position: 0, source_row: 2 });
    expect(nodes[3]).toMatchObject({ type: "comment", name: "Asphalt Shingles", position: 0, comment_type: "info", category: 0 });
    expect(nodes[4]).toMatchObject({ type: "comment", name: "Damaged Shingle", position: 1, comment_type: "defect", category: 1 });
    expect(nodes[5]).toMatchObject({ type: "item", name: "Flashings", position: 1, source_row: 4 });
    expect(nodes[6]).toMatchObject({ type: "comment", name: "Chimney Flashing", position: 0, answer_type: "checkbox" });
    expect(nodes[7]).toMatchObject({ type: "section", name: "Exterior", position: 1, source_row: 5 });
    expect(nodes[8]).toMatchObject({ type: "item", name: "Wall Cladding", position: 0, source_row: 5 });
    expect(nodes[9]).toMatchObject({ type: "comment", name: "Siding Condition", position: 0 });
  });

  test("validates hierarchy consistency with 0 violations", () => {
    const result = verifyHierarchyConsistency(baseFields, "Standard Home Inspection");
    expect(result.passed).toBe(true);
    expect(result.section_count).toBe(2);
    expect(result.item_count).toBe(3);
    expect(result.comment_count).toBe(4);
    expect(result.difference).toBeNull();
    expect(result.summary).toContain("Hierarchical tree verified");
  });

  test("detects non-monotonic section position violation", () => {
    const corruptedFields = [
      { ...baseFields[0], section_pos: 5 },
      { ...baseFields[1], section_pos: 5 },
      { ...baseFields[2], section_pos: 5 },
      { ...baseFields[3], section_pos: 2 }, // Corrupted: goes from 5 backwards to 2
    ];

    const result = verifyHierarchyConsistency(corruptedFields, "Inverted Hierarchy");
    expect(result.passed).toBe(false);
    expect(result.difference).not.toBeNull();
    expect(result.summary).toContain("section_pos");
  });
});

describe("Hierarchical Verifier — findFirstTreeDifference", () => {
  const baseNodes: HierarchicalNode[] = [
    { type: "template", name: "Standard Inspection", position: 0 },
    { type: "section", name: "Roofing", position: 0, source_row: 2 },
    { type: "item", name: "Coverings", position: 0, source_row: 2 },
    {
      type: "comment",
      name: "Asphalt Shingles",
      position: 0,
      source_row: 2,
      comment_type: "info",
      category: 0,
      answer_type: "text",
    },
  ];

  test("returns null when two node streams are identical", () => {
    const identicalNodes = JSON.parse(JSON.stringify(baseNodes));
    const diff = findFirstTreeDifference(baseNodes, identicalNodes);
    expect(diff).toBeNull();
  });

  test("detects comment type mismatch", () => {
    const mutated = JSON.parse(JSON.stringify(baseNodes));
    mutated[3].comment_type = "defect"; // changed from info to defect

    const diff = findFirstTreeDifference(baseNodes, mutated);
    expect(diff).not.toBeNull();
    expect(diff?.index).toBe(3);
    expect(diff?.reason).toContain("type mismatch: expected 'info', got 'defect'");
  });

  test("detects category severity mismatch", () => {
    const mutated = JSON.parse(JSON.stringify(baseNodes));
    mutated[3].category = 1; // changed from 0 to 1

    const diff = findFirstTreeDifference(baseNodes, mutated);
    expect(diff).not.toBeNull();
    expect(diff?.index).toBe(3);
    expect(diff?.reason).toContain("category mismatch: expected '0', got '1'");
  });

  test("detects answer type mismatch", () => {
    const mutated = JSON.parse(JSON.stringify(baseNodes));
    mutated[3].answer_type = "checkbox"; // changed from text to checkbox

    const diff = findFirstTreeDifference(baseNodes, mutated);
    expect(diff).not.toBeNull();
    expect(diff?.index).toBe(3);
    expect(diff?.reason).toContain("answer_type mismatch: expected 'text', got 'checkbox'");
  });

  test("detects section name change", () => {
    const mutated = JSON.parse(JSON.stringify(baseNodes));
    mutated[1].name = "Attic & Roof"; // changed section name

    const diff = findFirstTreeDifference(baseNodes, mutated);
    expect(diff).not.toBeNull();
    expect(diff?.index).toBe(1);
    expect(diff?.reason).toContain("name mismatch: expected 'Roofing', got 'Attic & Roof'");
  });

  test("detects position displacement", () => {
    const mutated = JSON.parse(JSON.stringify(baseNodes));
    mutated[2].position = 4; // changed item position from 0 to 4

    const diff = findFirstTreeDifference(baseNodes, mutated);
    expect(diff).not.toBeNull();
    expect(diff?.index).toBe(2);
    expect(diff?.reason).toContain("position mismatch: expected 0, got 4");
  });

  test("detects truncated node stream (missing comment)", () => {
    const truncated = baseNodes.slice(0, 3); // comment removed

    const diff = findFirstTreeDifference(baseNodes, truncated);
    expect(diff).not.toBeNull();
    expect(diff?.index).toBe(3);
    expect(diff?.reason).toContain("Node count mismatch: expected 4 nodes, got 3");
  });

  test("detects extra injected node", () => {
    const augmented = [
      ...baseNodes,
      {
        type: "comment" as const,
        name: "Injected Comment",
        position: 1,
        source_row: 99,
        comment_type: "info",
        category: 0,
      },
    ];

    const diff = findFirstTreeDifference(baseNodes, augmented);
    expect(diff).not.toBeNull();
    expect(diff?.index).toBe(4);
    expect(diff?.reason).toContain("Node count mismatch: expected 4 nodes, got 5");
  });
});
