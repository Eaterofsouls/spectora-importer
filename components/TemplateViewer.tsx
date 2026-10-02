'use client';

import { useState, useCallback, useTransition } from 'react';
import { sanitiseHtml } from '@/lib/sanitise';

interface Field {
  id: string;
  source_row: number;
  section_pos: number;
  item_pos: number;
  field_pos: number;
  section_name: string;
  item_name: string;
  comment_name: string;
  comment_text: string | null;
  comment_type: string | null;
  category: number | null;
  answer_type: string | null;
  options_raw: string | null;
  snap_section_name: string;
  snap_item_name: string;
  snap_comment_name: string;
  snap_comment_text: string | null;
  updated_at: string;
}

type EditTarget =
  | { type: 'comment_text'; fieldId: string }
  | { type: 'comment_name'; fieldId: string }
  | { type: 'section_name'; sectionPos: number; fieldId: string }
  | { type: 'item_name'; sectionPos: number; itemPos: number; fieldId: string }
  | null;

interface Props {
  templateId: string;
  templateName: string;
  isSeed: boolean;
  fields: Field[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupBySection(fields: Field[]): Map<number, { name: string; items: Map<number, { name: string; fields: Field[] }> }> {
  const sections = new Map<number, { name: string; items: Map<number, { name: string; fields: Field[] }> }>();
  for (const f of fields) {
    if (!sections.has(f.section_pos)) {
      sections.set(f.section_pos, { name: f.section_name, items: new Map() });
    }
    const section = sections.get(f.section_pos)!;
    if (!section.items.has(f.item_pos)) {
      section.items.set(f.item_pos, { name: f.item_name, fields: [] });
    }
    section.items.get(f.item_pos)!.fields.push(f);
  }
  return sections;
}

function categoryLabel(cat: number | null): string {
  if (cat === 1) return '🔴 High';
  if (cat === 0) return '🟡 Med';
  if (cat === -1) return '🟢 Low';
  return '—';
}

function commentTypeColor(type: string | null): string {
  if (type === 'defect') return 'text-red-600 dark:text-red-400';
  if (type === 'limit') return 'text-amber-600 dark:text-amber-400';
  if (type === 'info') return 'text-blue-600 dark:text-blue-400';
  return 'text-gray-400';
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TemplateViewer({ templateId, templateName, isSeed, fields: initialFields }: Props) {
  const [fields, setFields] = useState<Field[]>(initialFields);
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0]));

  const sections = groupBySection(fields);

  // ── Edit handlers ──────────────────────────────────────────────────────────

  const startEditCommentText = useCallback((field: Field) => {
    if (isSeed) return;
    setEditTarget({ type: 'comment_text', fieldId: field.id });
    setEditValue(field.comment_text ?? '');
    setError(null);
  }, [isSeed]);

  const startEditCommentName = useCallback((field: Field) => {
    if (isSeed) return;
    setEditTarget({ type: 'comment_name', fieldId: field.id });
    setEditValue(field.comment_name ?? '');
    setError(null);
  }, [isSeed]);

  const startEditSectionName = useCallback((sectionPos: number, firstField: Field) => {
    if (isSeed) return;
    setEditTarget({ type: 'section_name', sectionPos, fieldId: firstField.id });
    setEditValue(firstField.section_name);
    setError(null);
  }, [isSeed]);

  const startEditItemName = useCallback((sectionPos: number, itemPos: number, firstField: Field) => {
    if (isSeed) return;
    setEditTarget({ type: 'item_name', sectionPos, itemPos, fieldId: firstField.id });
    setEditValue(firstField.item_name);
    setError(null);
  }, [isSeed]);

  const cancelEdit = useCallback(() => {
    setEditTarget(null);
    setEditValue('');
    setError(null);
  }, []);

  const saveEdit = useCallback((field: Field) => {
    if (!editTarget) return;
    startSaving(async () => {
      const payload: Record<string, unknown> = {
        updated_at: field.updated_at,
      };

      if (editTarget.type === 'comment_text') {
        payload.comment_text = editValue;
      } else if (editTarget.type === 'comment_name') {
        payload.comment_name = editValue;
      } else if (editTarget.type === 'section_name') {
        payload.section_name = editValue;
      } else if (editTarget.type === 'item_name') {
        payload.item_name = editValue;
      }

      const res = await fetch(`/api/fields/${field.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? 'Save failed');
        return;
      }

      // Update local state based on edit type
      if (editTarget.type === 'comment_text') {
        setFields(prev => prev.map(f => f.id === field.id ? { ...f, comment_text: editValue, updated_at: json.field.updated_at } : f));
      } else if (editTarget.type === 'comment_name') {
        setFields(prev => prev.map(f => f.id === field.id ? { ...f, comment_name: editValue, updated_at: json.field.updated_at } : f));
      } else if (editTarget.type === 'section_name') {
        setFields(prev => prev.map(f => f.section_pos === editTarget.sectionPos ? { ...f, section_name: editValue, updated_at: json.field.updated_at } : f));
      } else if (editTarget.type === 'item_name') {
        setFields(prev => prev.map(f => f.section_pos === editTarget.sectionPos && f.item_pos === editTarget.itemPos ? { ...f, item_name: editValue, updated_at: json.field.updated_at } : f));
      }

      setEditTarget(null);
    });
  }, [editTarget, editValue]);

  const revertField = useCallback((field: Field) => {
    if (isSeed) return;
    startSaving(async () => {
      const res = await fetch(`/api/fields/${field.id}`, { method: 'PUT' });
      if (!res.ok) {
        setError('Revert failed');
        return;
      }
      setFields(prev => prev.map(f =>
        f.id === field.id
          ? { ...f, comment_text: f.snap_comment_text, comment_name: f.snap_comment_name, updated_at: new Date().toISOString() }
          : f
      ));
    });
  }, [isSeed]);

  const toggleSection = useCallback((pos: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(pos)) next.delete(pos);
      else next.add(pos);
      return next;
    });
  }, []);

  // ── Duplicate template ─────────────────────────────────────────────────────

  const [duplicating, setDuplicating] = useState(false);

  const duplicateTemplate = useCallback(async () => {
    setDuplicating(true);
    const res = await fetch(`/api/templates/${templateId}/duplicate`, { method: 'POST' });
    const json = await res.json();
    setDuplicating(false);
    if (res.ok) {
      window.location.href = `/templates/${json.template_id}`;
    } else {
      setError('Duplicate failed: ' + (json.error ?? 'unknown'));
    }
  }, [templateId]);

  return (
    <div className="w-full">
      {/* Template header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{templateName}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {sections.size} sections · {new Set(fields.map(f => `${f.section_pos}::${f.item_pos}`)).size} items · {fields.length} fields
            </span>
            {isSeed && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                Read-only seed
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/templates/${templateId}/export`}
            download
            className="px-3.5 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors inline-flex items-center gap-1.5 shadow-sm"
            title="Download full 42-column Spectora spreadsheet export with any edits applied"
          >
            <span>📥</span> Export (.xlsx)
          </a>
          {isSeed ? (
            <button
              onClick={duplicateTemplate}
              disabled={duplicating}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {duplicating ? 'Copying…' : '⊕ Copy to edit'}
            </button>
          ) : (
            <a
              href="/"
              className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              ← Import another
            </a>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Sections */}
      <div className="space-y-3">
        {Array.from(sections.entries()).map(([sectionPos, section]) => (
          <div key={sectionPos} className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            {/* Section header */}
            <div className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <button
                onClick={() => toggleSection(sectionPos)}
                className="flex items-center gap-2 text-left flex-1"
              >
                <span className="text-gray-400 text-sm">{expandedSections.has(sectionPos) ? '▼' : '▶'}</span>
                {editTarget?.type === 'section_name' && editTarget.sectionPos === sectionPos ? (
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      autoFocus
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="px-2 py-0.5 text-sm font-semibold border border-blue-400 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                    />
                    <button
                      onClick={() => {
                        const firstField = Array.from(section.items.values())[0]?.fields[0];
                        if (firstField) saveEdit(firstField);
                      }}
                      disabled={saving}
                      className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{section.name}</span>
                )}
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {section.items.size} items · {Array.from(section.items.values()).reduce((n, i) => n + i.fields.length, 0)} comments
                </span>
              </button>
              {!isSeed && editTarget?.type !== 'section_name' && (
                <button
                  onClick={() => {
                    const firstField = Array.from(section.items.values())[0]?.fields[0];
                    if (firstField) startEditSectionName(sectionPos, firstField);
                  }}
                  className="text-xs text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 px-2 py-1 rounded transition-colors"
                  title="Rename section"
                >
                  ✎ Rename section
                </button>
              )}
            </div>

            {/* Items */}
            {expandedSections.has(sectionPos) && (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {Array.from(section.items.entries()).map(([itemPos, item]) => (
                  <div key={itemPos} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      {editTarget?.type === 'item_name' && editTarget.sectionPos === sectionPos && editTarget.itemPos === itemPos ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="px-2 py-0.5 text-xs uppercase font-medium border border-blue-400 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                          />
                          <button
                            onClick={() => saveEdit(item.fields[0])}
                            disabled={saving}
                            className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                          {item.name}
                        </h3>
                      )}
                      {!isSeed && editTarget?.type !== 'item_name' && (
                        <button
                          onClick={() => startEditItemName(sectionPos, itemPos, item.fields[0])}
                          className="text-xs text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 px-1 py-0.5 rounded transition-colors"
                          title="Rename item"
                        >
                          ✎ Rename item
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {item.fields.map((field) => {
                        const isEditing = editTarget?.type === 'comment_text' && editTarget.fieldId === field.id;
                        const isModified = field.comment_text !== field.snap_comment_text || field.comment_name !== field.snap_comment_name;

                        return (
                          <div
                            key={field.id}
                            className={`group rounded-lg border p-3 transition-colors ${
                              isEditing
                                ? 'border-blue-400 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-900/10'
                                : isModified
                                ? 'border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-900/10'
                                : 'border-transparent bg-white dark:bg-gray-900/50 hover:border-gray-200 dark:hover:border-gray-700'
                            }`}
                          >
                            {/* Field header */}
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                {editTarget?.type === 'comment_name' && editTarget.fieldId === field.id ? (
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      autoFocus
                                      type="text"
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      className="px-2 py-0.5 text-sm border border-blue-400 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                                    />
                                    <button
                                      onClick={() => saveEdit(field)}
                                      disabled={saving}
                                      className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={cancelEdit}
                                      className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                                    {field.comment_name || <span className="italic text-gray-400">(no name)</span>}
                                  </span>
                                )}
                                {field.comment_type && (
                                  <span className={`text-xs font-medium ${commentTypeColor(field.comment_type)}`}>
                                    {field.comment_type}
                                  </span>
                                )}
                                {field.category !== null && (
                                  <span className="text-xs text-gray-400">{categoryLabel(field.category)}</span>
                                )}
                                {field.answer_type && (
                                  <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">
                                    {field.answer_type}
                                  </span>
                                )}
                                {isModified && (
                                  <span className="text-xs text-amber-600 dark:text-amber-400">● edited</span>
                                )}
                              </div>
                              {!isSeed && (
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                  {isModified && (
                                    <button
                                      onClick={() => revertField(field)}
                                      disabled={saving}
                                      title="Revert to as-imported"
                                      className="text-xs px-2 py-1 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded transition-colors"
                                    >
                                      ↩ revert
                                    </button>
                                  )}
                                  {!isEditing && (
                                    <>
                                      <button
                                        onClick={() => startEditCommentName(field)}
                                        className="text-xs px-2 py-1 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded transition-colors"
                                        title="Rename comment"
                                      >
                                        Rename
                                      </button>
                                      <button
                                        onClick={() => startEditCommentText(field)}
                                        className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                                      >
                                        Edit Text
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Comment text — read view */}
                            {!isEditing && field.comment_text && (
                              <div
                                className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mt-1 prose prose-sm dark:prose-invert max-w-none"
                                dangerouslySetInnerHTML={{ __html: sanitiseHtml(field.comment_text) }}
                              />
                            )}
                            {!isEditing && !field.comment_text && (
                              <p className="text-xs text-gray-400 dark:text-gray-600 italic mt-1">
                                (input field — no canned comment text)
                              </p>
                            )}

                            {/* Edit view — dual pane */}
                            {isEditing && (
                              <div className="mt-2 space-y-3">
                                <div className="grid grid-cols-2 gap-2">
                                  {/* Raw HTML editor */}
                                  <div>
                                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Raw HTML (stored as-is)</label>
                                    <textarea
                                      autoFocus
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      className="w-full h-32 text-xs font-mono p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                  </div>
                                  {/* Live rendered preview */}
                                  <div>
                                    <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Rendered preview</label>
                                    <div
                                      className="h-32 overflow-auto p-2 border border-gray-200 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 prose prose-sm dark:prose-invert max-w-none"
                                      dangerouslySetInnerHTML={{ __html: sanitiseHtml(editValue) }}
                                    />
                                  </div>
                                </div>
                                {/* Original value reference */}
                                {field.snap_comment_text && field.snap_comment_text !== editValue && (
                                  <div className="text-xs text-gray-400 dark:text-gray-500">
                                    <span className="font-medium">As imported: </span>
                                    <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">
                                      {field.snap_comment_text.substring(0, 120)}{field.snap_comment_text.length > 120 ? '…' : ''}
                                    </code>
                                  </div>
                                )}
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => saveEdit(field)}
                                    disabled={saving}
                                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
                                  >
                                    {saving ? 'Saving…' : 'Save'}
                                  </button>
                                  <button
                                    onClick={cancelEdit}
                                    className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Options (read-only) */}
                            {field.options_raw && (
                              <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                                Options: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{field.options_raw}</code>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
