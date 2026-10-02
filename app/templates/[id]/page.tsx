import { notFound } from 'next/navigation';
import { createSupabaseServiceClient } from '@/lib/supabase';
import TemplateViewer from '@/components/TemplateViewer';

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
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <a href="/" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
            ← Back
          </a>
          <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
            Imported from <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{template.source_file}</code>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Import report banner */}
        {(errorCount > 0 || warnCount > 0 || verifyIssues.length > 0) && (
          <div className="mb-6 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
            <h3 className="font-medium text-amber-800 dark:text-amber-300 text-sm mb-2">Import report</h3>
            <div className="flex gap-4 text-sm">
              {errorCount > 0 && (
                <span className="text-red-600 dark:text-red-400">🔴 {errorCount} error{errorCount !== 1 ? 's' : ''}</span>
              )}
              {warnCount > 0 && (
                <span className="text-amber-600 dark:text-amber-400">🟡 {warnCount} warning{warnCount !== 1 ? 's' : ''}</span>
              )}
              {verifyIssues.length > 0 && (
                <span className="text-purple-600 dark:text-purple-400">
                  ⚠️ {verifyIssues.length} verification issue{verifyIssues.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {verifyIssues.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                Verification mismatches detected — the DB write path check found inconsistencies.
                This is unexpected and should be reported.
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
