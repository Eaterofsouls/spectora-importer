import { notFound } from 'next/navigation';
import { createSupabaseServiceClient } from '@/lib/supabase';
import TemplateViewer from '@/components/TemplateViewer';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TemplatePage({ params }: Props) {
  const { id } = await params;
  const supabase = createSupabaseServiceClient();

  // Load template metadata
  const { data: template, error: tErr } = await supabase
    .from('templates')
    .select('id, name, source_file, is_seed, imported_at')
    .eq('id', id)
    .single();

  if (tErr || !template) {
    notFound();
  }

  // Load fields ordered by section/item/field position
  const { data: fields, error: fErr } = await supabase
    .from('fields')
    .select('*')
    .eq('template_id', id)
    .order('section_pos')
    .order('item_pos')
    .order('field_pos');

  if (fErr || !fields) {
    notFound();
  }

  // Load import issues for this template
  const { data: issues } = await supabase
    .from('import_issues')
    .select('severity, code, message, source_row')
    .eq('template_id', id)
    .order('severity');

  const errorCount = issues?.filter(i => i.severity === 'error').length ?? 0;
  const warnCount = issues?.filter(i => i.severity === 'warning').length ?? 0;
  const verifyIssues = issues?.filter(i => i.severity === 'verify') ?? [];

  return (
    <main className="min-h-screen bg-slate-50/80 dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased selection:bg-amber-100 selection:text-amber-900">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-white/80 dark:bg-slate-900/80 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <a
              href="/templates"
              className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-950/40 dark:hover:text-amber-300 transition-colors btn-press flex items-center gap-1.5"
            >
              <span>←</span>
              <span>All Templates</span>
            </a>
            <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 dark:text-white text-sm truncate max-w-xs sm:max-w-md">
                {template.name}
              </span>
              {template.is_seed ? (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200/70 dark:border-amber-800/60">
                  Seed Template
                </span>
              ) : (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60">
                  Imported
                </span>
              )}
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 font-mono">
            <span>Source:</span>
            <span className="text-slate-600 dark:text-slate-300 truncate max-w-[180px]">
              {template.source_file}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content with Negative Space */}
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-6">
        {/* Verification & Issues Alert */}
        {(errorCount > 0 || warnCount > 0 || verifyIssues.length > 0) && (
          <div className="rounded-2xl border border-amber-200/80 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-amber-900 dark:text-amber-200 text-sm flex items-center gap-2">
                <span>📋</span>
                <span>Fidelity Audit Report</span>
              </h3>
              <div className="flex gap-2">
                {errorCount > 0 && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200">
                    {errorCount} error{errorCount !== 1 ? 's' : ''}
                  </span>
                )}
                {warnCount > 0 && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                    {warnCount} notice{warnCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
            {verifyIssues.length > 0 && (
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Verification checks detected {verifyIssues.length} mismatch(es) against source data.
              </p>
            )}
          </div>
        )}

        <TemplateViewer
          templateId={template.id}
          templateName={template.name}
          isSeed={template.is_seed}
          fields={fields}
        />
      </div>
    </main>
  );
}
