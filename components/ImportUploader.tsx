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
        setError(json.error ?? { code: 'UNKNOWN', message: 'Unknown error.' });
        setStatus('error');
        return;
      }

      setResult(json);
      setStatus('done');
    } catch {
      setError({ code: 'NETWORK_ERROR', message: 'Network error. Please try again.' });
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
            border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all
            ${dragOver
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'}
          `}
        >
          <div className="text-4xl mb-3">📂</div>
          <p className="text-lg font-medium text-gray-700 dark:text-gray-200">
            Drop your Spectora export here
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Templates → Export to Spreadsheet → <strong>Export HTML Text</strong> (.xls)
          </p>
          <label className="mt-4 inline-block cursor-pointer">
            <span className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
              Choose file
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
        <div className="border rounded-xl p-8 text-center">
          <div className="animate-spin text-3xl mb-3">⚙️</div>
          <p className="text-gray-600 dark:text-gray-300 font-medium">Parsing and importing…</p>
          <p className="text-sm text-gray-400 mt-1">Verifying fidelity after import</p>
        </div>
      )}

      {/* Error */}
      {status === 'error' && error && (
        <div className="border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-semibold text-red-800 dark:text-red-300">
                Import failed — {error.code}
              </p>
              <p className="mt-1 text-sm text-red-700 dark:text-red-400">
                {error.message}
              </p>
            </div>
          </div>
          <button
            onClick={() => { setStatus('idle'); setError(null); }}
            className="mt-4 px-4 py-2 text-sm bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-300 rounded-lg hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* Success */}
      {status === 'done' && result && (
        <div className="border border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-800 rounded-xl p-6 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl">✅</span>
                <p className="font-semibold text-green-800 dark:text-green-300 text-lg">
                  {result.name}
                </p>
              </div>
              <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                Template imported successfully
              </p>
            </div>
          </div>

          {/* Import counts — the import report Hive is missing */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center border border-green-200 dark:border-green-800">
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {result.section_count}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Sections</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center border border-green-200 dark:border-green-800">
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {result.item_count}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Items</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 text-center border border-green-200 dark:border-green-800">
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {result.field_count}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Fields</div>
            </div>
          </div>

          {/* Verification result */}
          {result.verification && (
            <div className={`rounded-lg p-3 text-sm flex items-start gap-2 ${
              result.verification.passed
                ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
            }`}>
              <span>{result.verification.passed ? '🔒' : '⚠️'}</span>
              <div>
                <span className="font-medium">Fidelity check: </span>
                {result.verification.summary}
                {!result.verification.passed && (
                  <p className="mt-1 text-xs opacity-75">
                    {result.verification.mismatch_count} mismatch(es) found. Details available in the template view.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Issues summary */}
          {(result.issues.errors > 0 || result.issues.warnings > 0) && (
            <div className="text-sm text-amber-700 dark:text-amber-400">
              {result.issues.errors > 0 && (
                <span className="mr-3">🔴 {result.issues.errors} error{result.issues.errors !== 1 ? 's' : ''}</span>
              )}
              {result.issues.warnings > 0 && (
                <span>🟡 {result.issues.warnings} warning{result.issues.warnings !== 1 ? 's' : ''}</span>
              )}
            </div>
          )}

          {/* Info notes (e.g. ORDER_TIE, EMPTY_COMMENT_TEXT) */}
          {result.issues.info > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              ℹ️ {result.issues.info} informational note{result.issues.info !== 1 ? 's' : ''} (e.g. 83 fields have no comment text — they're input questions, not narrative comments)
            </p>
          )}

          {/* CTA */}
          <button
            onClick={() => router.push(`/templates/${result.template_id}`)}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm"
          >
            Review imported template →
          </button>

          <button
            onClick={() => { setStatus('idle'); setResult(null); }}
            className="w-full py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            Import another template
          </button>
        </div>
      )}
    </div>
  );
}
