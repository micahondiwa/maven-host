import {createHash} from 'node:crypto'
import {readdir,readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {localPool} from './database.mjs'

const BASELINE='0001_django_baseline.sql'

// The baseline mirrors the v1 Django schema. A database that already carries that schema (production) is
// adopted only when every Django migration the baseline represents is recorded as applied.
async function adoptDjangoSchema(client,sql){
 if(!(await client.query("SELECT to_regclass('public.django_migrations') AS t")).rows[0].t)return false
 const expected=[...sql.matchAll(/INSERT INTO public\.django_migrations VALUES \(\d+, '([^']+)', '([^']+)'/g)].map(m=>`${m[1]}.${m[2]}`)
 const applied=new Set((await client.query("SELECT app||'.'||name AS n FROM django_migrations")).rows.map(r=>r.n))
 const missing=expected.filter(name=>!applied.has(name))
 if(missing.length)throw new Error(`Existing Django schema is not at the v1 reference state; missing: ${missing.join(', ')}`)
 return true
}

const pool=localPool(),client=await pool.connect()
try {
 const version=Number((await client.query('SHOW server_version_num')).rows[0].server_version_num)
 if(version<100000)throw new Error('PostgreSQL 10 or newer is required')
 await client.query('SELECT pg_advisory_lock($1)',[84190921])
 await client.query('CREATE TABLE IF NOT EXISTS maven_migrations (name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)')
 const folder=fileURLToPath(new URL('../server/db/migrations/',import.meta.url))
 for(const name of (await readdir(folder)).filter(n=>/^\d+_[a-z0-9_]+\.sql$/.test(n)).sort()) {
  const sql=await readFile(`${folder}/${name}`,'utf8'),checksum=createHash('sha256').update(sql).digest('hex')
  const previous=(await client.query('SELECT checksum FROM maven_migrations WHERE name=$1',[name])).rows[0]
  if(previous){if(previous.checksum!==checksum)throw new Error(`Previously applied migration changed: ${name}`);continue}
  await client.query('BEGIN')
  try{
   if(name===BASELINE&&await adoptDjangoSchema(client,sql))console.log(`Adopted existing Django schema as ${name}`)
   else{await client.query(sql);console.log(`Applied ${name}`)}
   await client.query('INSERT INTO maven_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);await client.query('COMMIT')
  }catch(error){await client.query('ROLLBACK');throw error}
 }
 console.log(`Migrations verified on PostgreSQL major ${Math.floor(version/10000)}`)
}finally{await client.query('SELECT pg_advisory_unlock($1)',[84190921]).catch(()=>{});client.release();await pool.end()}
