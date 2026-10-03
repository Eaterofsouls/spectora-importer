import Link from "next/link";

export const metadata = {
  title: "Walkthrough Video | Hive Inspect Spectora Importer",
  description: "End-to-end technical demonstration of the Spectora template importer for Hive Inspect.",
};

export default function WalkthroughPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation */}
      <header className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center font-bold text-slate-950 text-lg shadow-sm shadow-amber-500/30">
              H
            </span>
            <span className="font-semibold tracking-tight text-white">Hive Inspect Importer</span>
          </Link>
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
            FDE Assignment
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href="/"
            className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            ← Live App
          </Link>
          <a
            href="https://github.com/Eaterofsouls/spectora-importer"
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium transition-colors border border-slate-700/60"
          >
            GitHub Repo ↗
          </a>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
            <span>Video Walkthrough</span>
            <span>•</span>
            <span>1080p 60fps</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Spectora Template Importer — Technical Architecture & Live Demo
          </h1>
          <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
            Walkthrough covering zero silent data loss, physical walking order preservation, 42-column round-trip re-export, and live terminal test verification.
          </p>
        </div>

        {/* Video Player Card */}
        <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl shadow-black/60 aspect-video flex items-center justify-center">
          <video
            controls
            autoPlay
            muted
            playsInline
            preload="metadata"
            className="w-full h-full object-contain"
            src="/walkthrough.mp4"
          >
            Your browser does not support the video tag.
          </video>
        </div>

        {/* Video Chapters / Agenda */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider text-amber-400">
              Walkthrough Chapters
            </h3>
            <ul className="space-y-2 text-xs sm:text-sm text-slate-300">
              <li className="flex items-start gap-2">
                <span className="font-mono text-amber-400 font-semibold shrink-0">00:00</span>
                <span>The Core Problem & Customer Psychology (Zero Switching Friction)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono text-amber-400 font-semibold shrink-0">02:15</span>
                <span>Live Demo: 42-Column Parsing, Row Accounting & Postgres Write-Path Verification</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono text-amber-400 font-semibold shrink-0">04:45</span>
                <span>Codebase Walkthrough: Parser Engine, Air-Gapped AI Auditor & 100 Jest Tests</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono text-amber-400 font-semibold shrink-0">06:00</span>
                <span>Data Model: Meridian Derivation, Positional Ordinals & raw_cells JSONB</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono text-amber-400 font-semibold shrink-0">07:15</span>
                <span>Customer Anti-Lock-In: 42-Column Round-Trip Re-Export to XLSX & Binsr Comparison</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono text-amber-400 font-semibold shrink-0">08:25</span>
                <span>Real Failure Handling: Download Page Trap & 8-Vector Tamper Test Suite</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-mono text-amber-400 font-semibold shrink-0">09:15</span>
                <span>Product Feedback for Hive: Modal Copy, Unsaved Banner & Walking Sequence</span>
              </li>
            </ul>
          </div>

          <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider text-amber-400">
              Architecture Invariants
            </h3>
            <div className="space-y-2.5 text-xs sm:text-sm text-slate-300">
              <p>
                <strong className="text-white">Stratum 0 (Zero Silent Loss):</strong> All 42 original columns are preserved losslessly in <code className="text-amber-300 font-mono text-xs">raw_cells JSONB</code>.
              </p>
              <p>
                <strong className="text-white">Positional Ordinals:</strong> Hierarchy mapped strictly via physical row order, resolving Spectora's broken Order column (tied zeroes across 38 items).
              </p>
              <p>
                <strong className="text-white">Production Rigor:</strong> 13 Jest suites passing 100/100 tests with format forensics, tamper injection, and 8 holdout templates.
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-800/80 py-4 text-center text-xs text-slate-500">
        Hive Inspect FDE Take-Home Assignment • Built by Daksh Chauhan
      </footer>
    </div>
  );
}
