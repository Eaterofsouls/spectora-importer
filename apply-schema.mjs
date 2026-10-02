// apply-schema.mjs — run once to create tables + RLS
// Usage: node apply-schema.mjs

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://axmhojbvgggxybsprure.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4bWhvamJ2Z2dneHlic3BydXJlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDk0MzA3OCwiZXhwIjoyMTA2NTE5MDc4fQ.ayL1qQpRJDohKgPjMRtwpOjEQtAHJ9vwUw7z3V6lpl4';

// Use the Supabase Management API to run SQL
const res = await fetch(
  `https://api.supabase.com/v1/projects/axmhojbvgggxybsprure/database/query`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`
    },
    body: JSON.stringify({
      query: readFileSync('./schema/schema.sql', 'utf8')
    })
  }
);

const text = await res.text();
console.log('Status:', res.status);
console.log('Response:', text.substring(0, 500));

if (res.ok) {
  console.log('\n✓ Schema applied successfully');
} else {
  console.error('\n✗ Schema application failed');
  process.exit(1);
}
