import 'server-only'
import { Pool, type PoolClient } from 'pg'
let pool: Pool | undefined
export function database() {
 if(!process.env.DATABASE_URL)throw new Error('Database configuration missing')
 const url=new URL(process.env.DATABASE_URL)
 if(process.env.APP_ENV!=='production' && (process.env.LOCAL_DATABASE_ONLY!=='true'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.startsWith('/mavenhost_')))throw new Error('Local development requires an isolated loopback database')
 if(!pool)pool=new Pool({connectionString:process.env.DATABASE_URL,max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:10000})
 return pool
}
export async function transaction<T>(run:(client:PoolClient)=>Promise<T>):Promise<T> {
 const client=await database().connect()
 try{await client.query('BEGIN');const result=await run(client);await client.query('COMMIT');return result}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
