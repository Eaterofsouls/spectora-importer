// apply-schema-direct.mjs
// Applies schema by calling Supabase's postgres REST endpoint directly
// Uses pg (postgres) driver with the direct connection string

import { readFileSync } from 'fs';

const SUPABASE_URL = 'https://axmhojbvgggxybsprure.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4bWhvamJ2Z2dneHlic3BydXJlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDk0MzA3OCwiZXhwIjoyMTA2NTE5MDc4fQ.ayL1qQpRJDohKgPjMRtwpOjEQtAHJ9vwUw7z3V6lpl4';

// Split SQL into individual statements and run each via a helper RPC
// We create a helper function first, then use it, then drop it
const sql = readFileSync('./schema/schema.sql', 'utf8');

// Use Supabase's built-in pg_dump equivalent: run SQL via the pg REST extension
// Actually use the correct endpoint: /pg/ which allows raw SQL with service role
async function runSQL(statement) {
  const trimmed = statement.trim();
  if (!trimmed || trimmed.startsWith('--')) return { ok: true, skipped: true };
  
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
    },
    body: JSON.stringify({ sql: trimmed })
  });
  
  return { ok: res.ok, status: res.status, body: await res.text() };
}

// Try running the whole thing as a single call using the pgrst endpoint
const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
  headers: {
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
  }
});

console.log('Supabase REST API accessible:', res.status);

// Try the pg endpoint
const pgRes = await fetch(`${SUPABASE_URL}/pg/query`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
  },
  body: JSON.stringify({ query: 'SELECT 1' })
});

console.log('/pg/query status:', pgRes.status, await pgRes.text().then(t => t.substring(0, 200)));
