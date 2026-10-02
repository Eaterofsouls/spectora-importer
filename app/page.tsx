import ImportUploader from '@/components/ImportUploader';

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Spectora → Hive Template Importer
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Faithful import with fidelity verification
            </p>
          </div>
          <a
            href="/templates"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            My templates →
          </a>
        </div>
      </header>

      {/* Main */}
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            Import your Spectora template
          </h2>
          <p className="mt-3 text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
            Export your template from Spectora using{' '}
            <strong>Templates → Export to Spreadsheet → Export HTML Text</strong>,
            then upload it here. We preserve your exact wording, order, and formatting.
          </p>
        </div>

        {/* Uploader */}
        <div className="max-w-lg mx-auto">
          <ImportUploader />
        </div>

        {/* What we preserve */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
            <div className="text-2xl mb-2">📋</div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              Exact order preserved
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              We use physical row order from your export — not the Order column, which has
              tied values in Spectora exports.
            </p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
            <div className="text-2xl mb-2">✍️</div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              HTML formatting intact
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Bold, italic, links, and paragraph breaks are stored byte-identical.
              We never sanitise or rewrite your comment text.
            </p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
            <div className="text-2xl mb-2">🔒</div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              Verified on import
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Every import runs a fidelity check. You see the exact count of sections,
              items, and fields — and any issues — before you start editing.
            </p>
          </div>
        </div>

        {/* Try the seed */}
        <div className="mt-10 text-center">
          <p className="text-sm text-gray-400 dark:text-gray-500">
            Or{' '}
            <a href="/templates/seed" className="text-blue-500 hover:underline">
              browse the pre-imported InterNACHI Residential template
            </a>{' '}
            to see what an imported template looks like.
          </p>
        </div>
      </div>
    </main>
  );
}
