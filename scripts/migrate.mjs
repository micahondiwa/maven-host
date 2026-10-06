import {createHash} from 'node:crypto'
import {readdir,readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {localPool} from './database.mjs'
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
  try{await client.query(sql);await client.query('INSERT INTO maven_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);await client.query('COMMIT');console.log(`Applied ${name}`)}catch(error){await client.query('ROLLBACK');throw error}
 }
 console.log(`Migrations verified on PostgreSQL major ${Math.floor(version/10000)}`)
}finally{await client.query('SELECT pg_advisory_unlock($1)',[84190921]).catch(()=>{});client.release();await pool.end()}
