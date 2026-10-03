import { createSupabaseServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface TemplateRow {
  id: string;
  name: string;
  source_file: string;
  is_seed: boolean;
  imported_at: string;
}

export default async function TemplatesListPage() {
  const supabase = createSupabaseServiceClient();

  const { data: templates } = await supabase
    .from('templates')
    .select('id, name, source_file, is_seed, imported_at')
    .order('is_seed', { ascending: false })
    .order('imported_at', { ascending: false });

  // Get field counts grouped by template
  const { data: fieldStats } = await supabase
    .from('fields')
    .select('template_id, section_name, item_name');

  const countsMap = new Map<string, { comments: number; sections: Set<string>; items: Set<string> }>();
  for (const f of fieldStats ?? []) {
    if (!countsMap.has(f.template_id)) {
      countsMap.set(f.template_id, { comments: 0, sections: new Set(), items: new Set() });
    }
    const stat = countsMap.get(f.template_id)!;
    stat.comments++;
    stat.sections.add(f.section_name);
    stat.items.add(`${f.section_name}::${f.item_name}`);
  }

  return (
    <main className="min-h-screen bg-slate-50/80 dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased selection:bg-amber-100 selection:text-amber-900">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-white/80 dark:bg-slate-900/80 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="flex items-center gap-3 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-white font-bold shadow-sm shadow-amber-500/20 group-hover:scale-105 transition-transform duration-200">
                <span className="text-base tracking-tighter">H</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 dark:text-white tracking-tight">Hive Inspect</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200/70 dark:border-amber-800/60">
                  Templates
                </span>
              </div>
            </a>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 rounded-xl shadow-sm shadow-amber-500/20 transition-all duration-200 btn-press flex items-center gap-1.5"
            >
              <span>+ Import New</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Content with Negative Space */}
      <div className="max-w-6xl mx-auto px-6 py-12 space-y-8">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Template Library
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Browse, preview, and manage your imported inspection templates.
          </p>
        </div>

        {/* Template Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {(templates as TemplateRow[] ?? []).map((t) => {
            const stats = countsMap.get(t.id) ?? { comments: 0, sections: new Set(), items: new Set() };
            return (
              <div
                key={t.id}
                className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs hover:shadow-md hover:border-amber-400/80 dark:hover:border-amber-500/50 transition-all duration-200 card-hover flex flex-col justify-between space-y-5"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-bold text-slate-900 dark:text-white text-base leading-snug line-clamp-2">
                      {t.name}
                    </h2>
                    {t.is_seed ? (
                      <span className="shrink-0 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/80">
                        Seed Master
                      </span>
                    ) : (
                      <span className="shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80">
                        Imported
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-400 dark:text-slate-500 font-mono truncate">
                    {t.source_file}
                  </p>

                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="text-center p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40">
                      <div className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                        {stats.sections.size}
                      </div>
                      <div className="text-[11px] text-slate-400">Sections</div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40">
                      <div className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                        {stats.items.size}
                      </div>
                      <div className="text-[11px] text-slate-400">Subsections</div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40">
                      <div className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                        {stats.comments}
                      </div>
                      <div className="text-[11px] text-slate-400">Comments</div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <a
                    href={`/templates/${t.id}`}
                    className="flex-1 py-2 text-center text-xs font-semibold bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 rounded-xl transition-all duration-150 btn-press"
                  >
                    Open Editor →
                  </a>
                  <a
                    href={`/api/templates/${t.id}/export`}
                    download
                    title="Export 42-column spreadsheet (.xlsx)"
                    className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-950/40 dark:hover:text-amber-300 rounded-xl transition-colors"
                  >
                    📥
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
