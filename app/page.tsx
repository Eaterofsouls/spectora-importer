import ImportUploader from '@/components/ImportUploader';

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50/80 dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased selection:bg-amber-100 selection:text-amber-900">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-white/80 dark:bg-slate-900/80 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-white font-bold shadow-sm shadow-amber-500/20">
              <span className="text-base tracking-tighter">H</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 dark:text-white tracking-tight">Hive Inspect</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200/70 dark:border-amber-800/60">
                  Migration Suite
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/templates"
              className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:text-amber-600 dark:hover:text-amber-400 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xs transition-all duration-200 btn-press flex items-center gap-1.5"
            >
              <span>Library</span>
              <span className="text-slate-400">→</span>
            </a>
          </div>
        </div>
      </header>

      {/* Hero Section with Generous Negative Space */}
      <div className="max-w-5xl mx-auto px-6 pt-16 pb-24 space-y-16">
        <div className="text-center max-w-2xl mx-auto space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold tracking-wide uppercase bg-amber-100/60 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/50">
            <span>✨ Zero Silent Loss Guarantee</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Spectora Template Importer
          </h1>
          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-400 leading-relaxed font-normal">
            Move your custom templates to Hive Inspect without losing formatting, walking order, or canned defect comments.
          </p>
        </div>

        {/* Uploader Card */}
        <div className="max-w-xl mx-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200/80 dark:border-slate-800 shadow-sm shadow-slate-200/50 dark:shadow-none space-y-6">
            <ImportUploader />
            
            {/* Guidance box */}
            <div className="rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 p-4 text-xs text-slate-600 dark:text-slate-300 space-y-1.5 leading-relaxed">
              <div className="font-semibold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                <span>💡</span> Recommended Spectora Export Steps:
              </div>
              <p>
                In Spectora, go to <strong>Templates</strong> → select your template → click <strong>Export to Spreadsheet</strong> → choose <strong>Export HTML Text</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* Value Props & Assurance Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs card-hover space-y-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center text-amber-600 text-lg border border-amber-100 dark:border-amber-900/50">
              ⚡
            </div>
            <h3 className="font-semibold text-slate-900 dark:text-white text-base">
              Physical Walking Order
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              We preserve exact physical row sequence from your export, resolving duplicate order values without scrambling your inspection flow.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs card-hover space-y-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 text-lg border border-emerald-100 dark:border-emerald-900/50">
              🛡️
            </div>
            <h3 className="font-semibold text-slate-900 dark:text-white text-base">
              Pre-Commit Verification
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Every import runs full cell-by-cell write-path verification against the raw source matrix with instant transactional rollback on mismatch.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs card-hover space-y-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-blue-600 text-lg border border-blue-100 dark:border-blue-900/50">
              🔄
            </div>
            <h3 className="font-semibold text-slate-900 dark:text-white text-base">
              Round-Trip Portability
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              No vendor lock-in. Re-export your template at any time into a complete 42-column spreadsheet (.xlsx) with your edits faithfully applied.
            </p>
          </div>
        </div>

        {/* Demo Seed Callout */}
        <div className="text-center pt-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Want to test drive first?{' '}
            <a
              href="/templates/b1ceca61-068b-4f5e-9d66-61ff9ed784c1"
              className="font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 underline underline-offset-4 decoration-amber-300 dark:decoration-amber-700 transition-colors"
            >
              Explore the InterNACHI Master Residential Template →
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
