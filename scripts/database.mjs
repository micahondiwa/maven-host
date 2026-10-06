import pg from 'pg'
export function localDatabaseUrl() {
 if(process.env.LOCAL_DATABASE_ONLY!=='true')throw new Error('Explicit LOCAL_DATABASE_ONLY=true is required during migration')
 const raw=process.env.DATABASE_URL
 if(!raw)throw new Error('DATABASE_URL is required')
 const url=new URL(raw)
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.startsWith('/mavenhost_'))throw new Error('Migration development only accepts isolated loopback mavenhost_ databases')
 return raw
}
export function localPool(){return new pg.Pool({connectionString:localDatabaseUrl(),max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:10000})}
