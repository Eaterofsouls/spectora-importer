'use client';

import { useState, useCallback, useTransition, useMemo } from 'react';
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

type TerminologyMode = 'spectora' | 'hive';
type FilterCategory = 'all' | 'defect' | 'limit' | 'info' | 'modified';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function categoryBadge(cat: number | null) {
  if (cat === 1) {
    return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200/70 dark:border-rose-900/60">High Priority</span>;
  }
  if (cat === 0) {
    return <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/70 dark:border-amber-900/60">Medium</span>;
  }
  if (cat === -1) {
    return <span className="text-[11px] font-normal px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">Low / Minor</span>;
  }
  return null;
}

function typeBadge(type: string | null) {
  if (type === 'defect') {
    return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-100/70 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-900/80">Defect</span>;
  }
  if (type === 'limit') {
    return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100/70 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-900/80">Limitation</span>;
  }
  if (type === 'info') {
    return <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-sky-100/60 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200 border border-sky-200/60 dark:border-sky-900/60">Information</span>;
  }
  return null;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TemplateViewer({ templateId, templateName, isSeed, fields: initialFields }: Props) {
  const [fields, setFields] = useState<Field[]>(initialFields);
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0]));
  
  // UX Enhancements
  const [terminology, setTerminology] = useState<TerminologyMode>('spectora');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterCategory>('all');
  const [duplicating, setDuplicating] = useState(false);

  // Terminology Labels
  const term = useMemo(() => ({
    section: 'Section',
    item: terminology === 'hive' ? 'Subsection' : 'Item',
    comment: terminology === 'hive' ? 'Field' : 'Comment',
  }), [terminology]);

  // Filtered fields based on search & filter pill
  const filteredFields = useMemo(() => {
    return fields.filter(f => {
      // Category filter
      if (activeFilter === 'defect' && f.comment_type !== 'defect') return false;
      if (activeFilter === 'limit' && f.comment_type !== 'limit') return false;
      if (activeFilter === 'info' && f.comment_type !== 'info') return false;
      if (activeFilter === 'modified') {
        const isModified = f.comment_text !== f.snap_comment_text || f.comment_name !== f.snap_comment_name;
        if (!isModified) return false;
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = f.comment_name?.toLowerCase().includes(q);
        const matchText = f.comment_text?.toLowerCase().includes(q);
        const matchItem = f.item_name?.toLowerCase().includes(q);
        const matchSec = f.section_name?.toLowerCase().includes(q);
        if (!matchName && !matchText && !matchItem && !matchSec) return false;
      }

      return true;
    });
  }, [fields, activeFilter, searchQuery]);

  // Group filtered fields into Section -> Item hierarchy
  const sections = useMemo(() => {
    const map = new Map<number, { name: string; items: Map<number, { name: string; fields: Field[] }> }>();
    for (const f of filteredFields) {
      if (!map.has(f.section_pos)) {
        map.set(f.section_pos, { name: f.section_name, items: new Map() });
      }
      const sec = map.get(f.section_pos)!;
      if (!sec.items.has(f.item_pos)) {
        sec.items.set(f.item_pos, { name: f.item_name, fields: [] });
      }
      sec.items.get(f.item_pos)!.fields.push(f);
    }
    return map;
  }, [filteredFields]);

  // Counts for filter pills
  const stats = useMemo(() => {
    const defects = fields.filter(f => f.comment_type === 'defect').length;
    const limits = fields.filter(f => f.comment_type === 'limit').length;
    const info = fields.filter(f => f.comment_type === 'info').length;
    const modified = fields.filter(f => f.comment_text !== f.snap_comment_text || f.comment_name !== f.snap_comment_name).length;
    return { all: fields.length, defects, limits, info, modified };
  }, [fields]);

  // ─── Edit Handlers ──────────────────────────────────────────────────────────

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
        setError(json.error?.message ?? 'Save rejected due to concurrency conflict or permission error.');
        return;
      }

      // Update local state
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
        setError('Revert failed.');
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

  const expandAll = useCallback(() => {
    setExpandedSections(new Set(Array.from(sections.keys())));
  }, [sections]);

  const collapseAll = useCallback(() => {
    setExpandedSections(new Set());
  }, []);

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
    <div className="w-full space-y-6">
      {/* Action Header Card with Negative Space */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 sm:p-8 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {templateName}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              {sections.size} {term.section.toLowerCase()}s · {fields.length} {term.comment.toLowerCase()}s mapped with lossless fidelity
            </p>
          </div>

          {/* Action CTAs */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <a
              href={`/api/templates/${templateId}/export`}
              download
              className="px-4 py-2 text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-950/40 dark:hover:text-amber-300 border border-slate-200 dark:border-slate-700 rounded-xl transition-all duration-150 btn-press flex items-center gap-2"
              title="Download clean 42-column spreadsheet (.xlsx) with edits"
            >
              <span>📥</span>
              <span>Export (.xlsx)</span>
            </a>

            <button
              onClick={duplicateTemplate}
              disabled={duplicating}
              className="px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 rounded-xl shadow-xs shadow-amber-500/20 disabled:opacity-50 transition-all duration-150 btn-press flex items-center gap-1.5"
            >
              <span>{duplicating ? 'Duplicating…' : (isSeed ? '⊕ Copy to Edit' : '⊕ Duplicate Template')}</span>
            </button>
          </div>
        </div>

        {/* Toolbar: Terminology Mode & Search & Filters */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
          {/* Terminology Switcher */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Terminology:</span>
            <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 border border-slate-200/80 dark:border-slate-700">
              <button
                onClick={() => setTerminology('spectora')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  terminology === 'spectora'
                    ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Spectora (Item/Comment)
              </button>
              <button
                onClick={() => setTerminology('hive')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  terminology === 'hive'
                    ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Hive (Subsection/Field)
              </button>
            </div>
          </div>

          {/* Expand / Collapse all */}
          <div className="flex items-center gap-2">
            <button
              onClick={expandAll}
              className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
            >
              Expand All
            </button>
            <span className="text-slate-300 dark:text-slate-700">·</span>
            <button
              onClick={collapseAll}
              className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* Search & Category Filter Pills */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input
              type="text"
              placeholder={`Filter ${term.comment.toLowerCase()}s by keyword...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setActiveFilter('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all btn-press shrink-0 ${
                activeFilter === 'all'
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-2xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
              }`}
            >
              All ({stats.all})
            </button>
            <button
              onClick={() => setActiveFilter('defect')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all btn-press shrink-0 ${
                activeFilter === 'defect'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100'
              }`}
            >
              Defects ({stats.defects})
            </button>
            <button
              onClick={() => setActiveFilter('limit')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all btn-press shrink-0 ${
                activeFilter === 'limit'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100'
              }`}
            >
              Limitations ({stats.limits})
            </button>
            <button
              onClick={() => setActiveFilter('info')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all btn-press shrink-0 ${
                activeFilter === 'info'
                  ? 'bg-sky-600 text-white shadow-2xs'
                  : 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 hover:bg-sky-100'
              }`}
            >
              Info ({stats.info})
            </button>
            {stats.modified > 0 && (
              <button
                onClick={() => setActiveFilter('modified')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all btn-press shrink-0 ${
                  activeFilter === 'modified'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'
                }`}
              >
                Edited ({stats.modified})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 rounded-2xl text-xs text-rose-800 dark:text-rose-300 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="underline hover:text-rose-900 font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* Sections List with Negative Space */}
      <div className="space-y-6">
        {Array.from(sections.entries()).map(([sectionPos, section]) => {
          const isExpanded = expandedSections.has(sectionPos);
          const totalSectionComments = Array.from(section.items.values()).reduce((n, i) => n + i.fields.length, 0);

          return (
            <div
              key={sectionPos}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden transition-all duration-200"
            >
              {/* Section Header */}
              <div className="flex items-center justify-between px-6 py-4 bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100/60 dark:hover:bg-slate-800/70 border-b border-slate-100 dark:border-slate-800 transition-colors">
                <button
                  onClick={() => toggleSection(sectionPos)}
                  className="flex items-center gap-3 text-left flex-1"
                >
                  <span className={`text-xs text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-90 text-amber-600' : ''}`}>
                    ▶
                  </span>

                  {editTarget?.type === 'section_name' && editTarget.sectionPos === sectionPos ? (
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        autoFocus
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="px-2.5 py-1 text-sm font-bold border border-amber-500 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none"
                      />
                      <button
                        onClick={() => {
                          const firstField = Array.from(section.items.values())[0]?.fields[0];
                          if (firstField) saveEdit(firstField);
                        }}
                        disabled={saving}
                        className="text-xs px-2.5 py-1 bg-amber-600 text-white rounded-lg hover:bg-amber-700 btn-press font-semibold"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="text-xs px-2.5 py-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5">
                      <span className="font-bold text-slate-900 dark:text-white text-base">
                        {section.name}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium">
                        {totalSectionComments} {totalSectionComments === 1 ? term.comment.toLowerCase() : term.comment.toLowerCase() + 's'}
                      </span>
                    </div>
                  )}
                </button>

                {!isSeed && editTarget?.type !== 'section_name' && (
                  <button
                    onClick={() => {
                      const firstField = Array.from(section.items.values())[0]?.fields[0];
                      if (firstField) startEditSectionName(sectionPos, firstField);
                    }}
                    className="text-xs text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 px-2 py-1 rounded-lg transition-colors"
                    title="Rename section"
                  >
                    ✎ Rename
                  </button>
                )}
              </div>

              {/* Subsections / Items Accordion Body */}
              {isExpanded && (
                <div className="p-6 space-y-6 divide-y divide-slate-100 dark:divide-slate-800">
                  {Array.from(section.items.entries()).map(([itemPos, item], itemIdx) => (
                    <div key={itemPos} className={itemIdx > 0 ? 'pt-6 space-y-3' : 'space-y-3'}>
                      {/* Subsection Header */}
                      <div className="flex items-center justify-between">
                        {editTarget?.type === 'item_name' && editTarget.sectionPos === sectionPos && editTarget.itemPos === itemPos ? (
                          <div className="flex items-center gap-2">
                            <input
                              autoFocus
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="px-2 py-1 text-xs uppercase font-semibold border border-amber-500 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none"
                            />
                            <button
                              onClick={() => saveEdit(item.fields[0])}
                              disabled={saving}
                              className="text-xs px-2 py-1 bg-amber-600 text-white rounded-lg hover:bg-amber-700 btn-press font-semibold"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="text-xs px-2 py-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                            <span>{term.item}: {item.name}</span>
                            <span className="text-[10px] text-slate-400 font-normal">({item.fields.length})</span>
                          </h3>
                        )}

                        {!isSeed && editTarget?.type !== 'item_name' && (
                          <button
                            onClick={() => startEditItemName(sectionPos, itemPos, item.fields[0])}
                            className="text-xs text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 px-2 py-0.5 rounded-lg transition-colors"
                            title={`Rename ${term.item.toLowerCase()}`}
                          >
                            ✎ Rename
                          </button>
                        )}
                      </div>

                      {/* Comments / Fields List */}
                      <div className="space-y-3">
                        {item.fields.map((field) => {
                          const isEditing = editTarget?.type === 'comment_text' && editTarget.fieldId === field.id;
                          const isModified = field.comment_text !== field.snap_comment_text || field.comment_name !== field.snap_comment_name;

                          return (
                            <div
                              key={field.id}
                              className={`group rounded-xl p-4 transition-all duration-200 border ${
                                isEditing
                                  ? 'border-amber-500 bg-amber-50/20 dark:bg-amber-950/20 shadow-sm'
                                  : isModified
                                  ? 'border-emerald-300/80 dark:border-emerald-800 bg-emerald-50/20 dark:bg-emerald-950/10'
                                  : 'border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/60 hover:border-amber-300/80 hover:shadow-xs'
                              }`}
                            >
                              {/* Comment Header */}
                              <div className="flex items-start justify-between gap-3 mb-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {editTarget?.type === 'comment_name' && editTarget.fieldId === field.id ? (
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        autoFocus
                                        type="text"
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        className="px-2 py-1 text-sm border border-amber-500 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                                      />
                                      <button
                                        onClick={() => saveEdit(field)}
                                        disabled={saving}
                                        className="text-xs px-2.5 py-1 bg-amber-600 text-white rounded-lg hover:bg-amber-700 btn-press font-semibold"
                                      >
                                        Save
                                      </button>
                                      <button
                                        onClick={cancelEdit}
                                        className="text-xs px-2 py-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                      {field.comment_name || <span className="italic text-slate-400 font-normal">(Unnamed Comment)</span>}
                                    </span>
                                  )}

                                  {typeBadge(field.comment_type)}
                                  {categoryBadge(field.category)}

                                  {field.answer_type && (
                                    <span className="text-[11px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-md">
                                      {field.answer_type}
                                    </span>
                                  )}

                                  {isModified && (
                                    <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                      <span>●</span> Edited
                                    </span>
                                  )}
                                </div>

                                {!isSeed && (
                                  <div className="flex items-center gap-1 opacity-100 transition-opacity">
                                    {isModified && (
                                      <button
                                        onClick={() => revertField(field)}
                                        disabled={saving}
                                        title="Revert to as-imported original"
                                        className="text-xs px-2 py-1 font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40 rounded-lg transition-colors"
                                      >
                                        ↩ Revert
                                      </button>
                                    )}
                                    {!isEditing && (
                                      <>
                                        <button
                                          onClick={() => startEditCommentName(field)}
                                          className="text-xs px-2 py-1 text-slate-500 hover:text-amber-600 dark:text-slate-400 dark:hover:text-amber-300 rounded-lg transition-colors"
                                          title="Rename comment title"
                                        >
                                          Rename
                                        </button>
                                        <button
                                          onClick={() => startEditCommentText(field)}
                                          className="text-xs px-2.5 py-1 font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100/80 rounded-lg transition-colors btn-press"
                                        >
                                          Edit HTML
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Comment Narrative Content */}
                              {!isEditing && field.comment_text && (
                                <div
                                  className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed pt-1 prose prose-sm dark:prose-invert max-w-none"
                                  dangerouslySetInnerHTML={{ __html: sanitiseHtml(field.comment_text) }}
                                />
                              )}

                              {!isEditing && !field.comment_text && (
                                <p className="text-xs text-slate-400 dark:text-slate-500 italic pt-1">
                                  (Direct questionnaire input field — no canned observation text)
                                </p>
                              )}

                              {/* Dual-Pane Editor with Negative Space */}
                              {isEditing && (
                                <div className="mt-3 space-y-4 pt-3 border-t border-slate-200/80 dark:border-slate-800">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                                        Raw HTML Editor
                                      </label>
                                      <textarea
                                        autoFocus
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        className="w-full h-36 text-xs font-mono p-3 border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 shadow-inner"
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                                        Live Sanitized Preview
                                      </label>
                                      <div
                                        className="h-36 overflow-auto p-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-sm text-slate-700 dark:text-slate-300 prose prose-sm dark:prose-invert max-w-none"
                                        dangerouslySetInnerHTML={{ __html: sanitiseHtml(editValue) }}
                                      />
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between pt-1">
                                    <div className="text-xs text-slate-400">
                                      Safe tags: <code>&lt;p&gt;</code>, <code>&lt;strong&gt;</code>, <code>&lt;ul&gt;</code>, <code>&lt;a&gt;</code>
                                    </div>
                                    <div className="flex gap-2">
                                      <button
                                        onClick={cancelEdit}
                                        className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => saveEdit(field)}
                                        disabled={saving}
                                        className="px-4 py-1.5 text-xs font-semibold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-xl shadow-xs shadow-amber-500/20 disabled:opacity-50 transition-all btn-press"
                                      >
                                        {saving ? 'Saving…' : 'Save Changes'}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Multiple Choice Options Preview */}
                              {field.options_raw && (
                                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                                  <span className="font-semibold text-slate-400">Options:</span>
                                  <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300">
                                    {field.options_raw}
                                  </span>
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
          );
        })}
      </div>
    </div>
  );
}
