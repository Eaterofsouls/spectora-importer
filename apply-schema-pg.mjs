// apply-schema-pg.mjs — connects directly via postgres and runs schema.sql
import { readFileSync } from 'fs';
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'db.axmhojbvgggxybsprure.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'sTRg$%8t/7nB?_j',
  ssl: { rejectUnauthorized: false }
});

await client.connect();
console.log('Connected to Supabase Postgres');

const sql = readFileSync('./schema/schema.sql', 'utf8');
await client.query(sql);
console.log('✓ Schema applied');

await client.end();
