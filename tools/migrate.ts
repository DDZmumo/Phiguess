import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Db } from '../apps/server/src/db';

export async function migrate(db: Db) {
  await db.transaction(async sql => {
    await sql.query('SELECT pg_advisory_xact_lock(71830421)');
    await sql.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
    const applied=new Set((await sql.query('SELECT name FROM schema_migrations')).rows.map(r=>r.name));
    for (const file of (await readdir(resolve('db/migrations'))).filter(f=>f.endsWith('.sql')).sort()) {
      if (applied.has(file)) continue;
      await sql.query(await readFile(resolve('db/migrations',file),'utf8'));
      await sql.query('INSERT INTO schema_migrations(name) VALUES($1)',[file]);
    }
  });
}
if (require.main===module) {
  const db=new Db();
  void migrate(db).then(()=>console.log('Migrations applied')).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());
}
