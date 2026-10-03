'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface ImportResult {
  template_id: string;
  name: string;
  field_count: number;
  section_count: number;
  item_count: number;
  issues: {
    errors: number;
    warnings: number;
    info: number;
    items: Array<{
      source_row: number | null;
      severity: string;
      code: string;
      message: string;
    }>;
  };
  verification: {
    passed: boolean;
    summary: string;
    mismatch_count: number;
  } | null;
}

interface ImportError {
  code: string;
  message: string;
}

export default function ImportUploader() {
  const router = useRouter();
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<ImportError | null>(null);

  const upload = useCallback(async (file: File) => {
    setStatus('uploading');
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch('/api/import', { method: 'POST', body: form });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? { code: 'UNKNOWN', message: 'Unknown error occurred during import.' });
        setStatus('error');
        return;
      }

      setResult(json);
      setStatus('done');
    } catch {
      setError({ code: 'NETWORK_ERROR', message: 'Network connection failed. Please try again.' });
      setStatus('error');
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) upload(file);
  }, [upload]);

  const onFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload(file);
  }, [upload]);

  return (
    <div className="w-full">
      {/* Drop zone */}
      {status === 'idle' && (
        <div
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          className={`
            relative rounded-2xl p-10 text-center cursor-pointer transition-all duration-300
            border-2 border-dashed
            ${dragOver
              ? 'border-amber-500 bg-amber-50/60 dark:bg-amber-950/30 scale-[1.01] shadow-md shadow-amber-500/10'
              : 'border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 hover:border-amber-400 dark:hover:border-amber-500/70 hover:bg-amber-50/20'}
          `}
        >
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-amber-100/70 dark:bg-amber-950/60 flex items-center justify-center text-amber-600 dark:text-amber-400 text-2xl border border-amber-200/60 dark:border-amber-800/40 shadow-xs">
            📄
          </div>
          <p className="text-lg font-semibold text-slate-900 dark:text-white">
            Upload Spectora Template Spreadsheet
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
            Drop your <code className="px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800 font-mono text-slate-700 dark:text-slate-300">.xls</code> or <code className="px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800 font-mono text-slate-700 dark:text-slate-300">.xlsx</code> exported from Spectora
          </p>
          
          <label className="mt-5 inline-block cursor-pointer">
            <span className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-xl text-sm font-semibold shadow-sm shadow-amber-500/25 transition-all duration-200 btn-press inline-flex items-center gap-2">
              <span>Choose File</span>
              <span className="text-amber-200 font-normal">↑</span>
            </span>
            <input
              type="file"
              accept=".xls,.xlsx"
              className="hidden"
              onChange={onFileInput}
            />
          </label>
        </div>
      )}

      {/* Uploading */}
      {status === 'uploading' && (
        <div className="border border-amber-200/70 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/20 rounded-2xl p-10 text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-full border-3 border-amber-200 dark:border-amber-900 border-t-amber-600 animate-spin flex items-center justify-center" />
          <p className="text-slate-800 dark:text-slate-200 font-semibold text-base">
            Parsing & Verifying Integrity…
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Checking 42-column source matrix, visual grouping, and formula security
          </p>
        </div>
      )}

      {/* Error */}
      {status === 'error' && error && (
        <div className="border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/30 rounded-2xl p-6 space-y-4">
          <div className="flex items-start gap-3.5">
            <span className="text-2xl">⚠️</span>
            <div className="space-y-1">
              <p className="font-semibold text-rose-900 dark:text-rose-200 text-sm">
                Import Blocked — {error.code}
              </p>
              <p className="text-xs text-rose-700 dark:text-rose-300 leading-relaxed">
                {error.message}
              </p>
            </div>
          </div>
          <button
            onClick={() => { setStatus('idle'); setError(null); }}
            className="px-4 py-2 text-xs font-semibold bg-rose-100 hover:bg-rose-200 dark:bg-rose-900/50 dark:hover:bg-rose-900 text-rose-800 dark:text-rose-200 rounded-xl transition-all duration-150 btn-press"
          >
            Try again
          </button>
        </div>
      )}

      {/* Success */}
      {status === 'done' && result && (
        <div className="border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/20 rounded-2xl p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 text-lg border border-emerald-200 dark:border-emerald-800/80">
                ✓
              </div>
              <div>
                <p className="font-bold text-slate-900 dark:text-white text-base">
                  {result.name}
                </p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  Ready for review and editing
                </p>
              </div>
            </div>
          </div>

          {/* Counts */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 text-center border border-slate-200/80 dark:border-slate-800 shadow-2xs">
              <div className="text-xl font-extrabold text-slate-900 dark:text-white">
                {result.section_count}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Sections</div>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 text-center border border-slate-200/80 dark:border-slate-800 shadow-2xs">
              <div className="text-xl font-extrabold text-slate-900 dark:text-white">
                {result.item_count}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Subsections</div>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-xl p-3.5 text-center border border-slate-200/80 dark:border-slate-800 shadow-2xs">
              <div className="text-xl font-extrabold text-slate-900 dark:text-white">
                {result.field_count}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Comments</div>
            </div>
          </div>

          {/* Verification Badge */}
          {result.verification && (
            <div className={`rounded-xl p-3 text-xs flex items-center gap-2 border ${
              result.verification.passed
                ? 'bg-emerald-100/60 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300/80 dark:border-emerald-800'
                : 'bg-amber-100/60 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300/80 dark:border-amber-800'
            }`}>
              <span>{result.verification.passed ? '🔒' : '⚠️'}</span>
              <span className="font-medium">
                {result.verification.summary}
              </span>
            </div>
          )}

          {/* Action CTAs */}
          <div className="space-y-2 pt-1">
            <button
              onClick={() => router.push(`/templates/${result.template_id}`)}
              className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-xl font-semibold shadow-sm shadow-amber-500/20 text-sm transition-all duration-200 btn-press flex items-center justify-center gap-2"
            >
              <span>Open in Template Editor</span>
              <span>→</span>
            </button>
            <button
              onClick={() => { setStatus('idle'); setResult(null); }}
              className="w-full py-2 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
            >
              Import another template
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
