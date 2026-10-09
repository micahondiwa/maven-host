import 'server-only'
import pg, { Pool, type PoolClient, type QueryResultRow } from 'pg'

// Django serialises bigint primary keys as JSON numbers and dates without a time zone.
pg.types.setTypeParser(20, (value) => Number(value))
pg.types.setTypeParser(1082, (value) => value)

let pool: Pool | undefined
export type Queryable = Pool | PoolClient

export function database() {
 if(!process.env.DATABASE_URL)throw new Error('Database configuration missing')
 const url=new URL(process.env.DATABASE_URL)
 if(process.env.APP_ENV!=='production' && (process.env.LOCAL_DATABASE_ONLY!=='true'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.startsWith('/mavenhost_')))throw new Error('Local development requires an isolated loopback database')
 if(!pool)pool=new Pool({connectionString:process.env.DATABASE_URL,max:Number(process.env.DB_POOL_MAX)||4,connectionTimeoutMillis:5000,idleTimeoutMillis:10000})
 return pool
}

const commitCallbacks=new WeakMap<PoolClient,(()=>unknown)[]>()
const savepointDepth=new WeakMap<PoolClient,number>()

/**
 * Runs `run` atomically. Nested calls with the outer client use savepoints, like Django's nested `atomic()`.
 * Callbacks registered with `onCommit` run only after the outermost transaction commits.
 */
export async function transaction<T>(run:(client:PoolClient)=>Promise<T>,outer?:Queryable):Promise<T> {
 if(outer&&savepointDepth.has(outer as PoolClient)){
  const client=outer as PoolClient,depth=savepointDepth.get(client)!+1,name=`sp_${depth}`
  savepointDepth.set(client,depth)
  await client.query(`SAVEPOINT ${name}`)
  try{const result=await run(client);await client.query(`RELEASE SAVEPOINT ${name}`);return result}
  catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${name}`);throw error}
  finally{savepointDepth.set(client,depth-1)}
 }
 const client=await database().connect()
 commitCallbacks.set(client,[]);savepointDepth.set(client,0)
 let callbacks:(()=>unknown)[]=[]
 try{
  await client.query('BEGIN');const result=await run(client);await client.query('COMMIT')
  callbacks=commitCallbacks.get(client)??[]
  return result
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
 finally{
  commitCallbacks.delete(client);savepointDepth.delete(client);client.release()
  for(const callback of callbacks){try{await callback()}catch(error){console.error('on_commit callback failed',error)}}
 }
}

/** Django `transaction.on_commit(..., robust=True)`: deferred inside a transaction, immediate otherwise. */
export function onCommit(db:Queryable,callback:()=>unknown){
 const pending=commitCallbacks.get(db as PoolClient)
 if(pending)pending.push(callback)
 else Promise.resolve().then(callback).catch(error=>console.error('on_commit callback failed',error))
}

export async function query<T extends QueryResultRow=QueryResultRow>(sql:string,params:unknown[]=[],db:Queryable=database()):Promise<T[]>{
 return (await db.query<T>(sql,params)).rows
}

export async function queryOne<T extends QueryResultRow=QueryResultRow>(sql:string,params:unknown[]=[],db:Queryable=database()):Promise<T|undefined>{
 return (await db.query<T>(sql,params)).rows[0]
}
