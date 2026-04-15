/**
 * Runs tmp-reimport-messages.sql against Supabase via REST API
 * Usage: node scripts/run-sql-import.mjs
 */
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const SUPABASE_URL = 'https://bbdtoucanihtrymzpynq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiZHRvdWNhbmlodHJ5bXpweW5xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NDA0NjEsImV4cCI6MjA5MTMxNjQ2MX0.TPQtymiXFogCPCrT2ZbYFVZ7ziBrm5NNcB_XgPaPGPw';

const sql = readFileSync('tmp-reimport-messages.sql', 'utf8');

// Split into two batches at the second INSERT
const firstInsertIdx = sql.indexOf('INSERT INTO');
const secondInsertIdx = sql.indexOf('INSERT INTO', firstInsertIdx + 1);
const batch1 = secondInsertIdx > -1 ? sql.substring(0, secondInsertIdx).trim() : sql.trim();
const batch2 = secondInsertIdx > -1 ? sql.substring(secondInsertIdx).trim() : null;

async function runQuery(query, batchName) {
  console.log(`\nRunning ${batchName} (${query.length} chars)...`);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/madrasa_rel_teacher_bootstrap`, {
    method: 'HEAD',
  });
  // Use the Supabase SQL REST endpoint
  const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    method: 'GET',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    }
  });
  
  // Use pg REST for raw SQL
  const pgRes = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ query })
  });
  
  if (pgRes.ok) {
    const data = await pgRes.json();
    console.log(`✅ ${batchName} OK:`, data);
    return true;
  } else {
    const text = await pgRes.text();
    console.log(`❌ ${batchName} failed (${pgRes.status}):`, text.substring(0, 200));
    return false;
  }
}

// Try a different approach — use Supabase SQL via service role
// Actually anon key won't work for INSERT with RLS on messages
// Let's try the RPC approach that uses PIN-gating
// The correct approach is to use execute_sql via the MCP or SQL editor directly

// Instead, let's check what the current count is and show the SQL for manual paste
console.log('=== Messages Import SQL is ready ===');
console.log('Batch 1 lines:', batch1.split('\n').length);
console.log('Batch 2 lines:', batch2 ? batch2.split('\n').length : 0);
console.log('\nThe SQL has been generated to: tmp-reimport-messages.sql');
console.log('Please run it in Supabase SQL Editor (both batches)');
console.log('\nAlternatively, we can use the MCP execute_sql tool...');
