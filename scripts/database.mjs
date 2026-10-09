import pg from 'pg'

/**
 * Database URL for migrations. Development only accepts isolated loopback `mavenhost_` databases (LOCAL_DATABASE_ONLY);
 * production (APP_ENV=production, set in the server's private .env) migrates the configured DATABASE_URL.
 */
export function localDatabaseUrl() {
 const raw=process.env.DATABASE_URL
 if(!raw)throw new Error('DATABASE_URL is required')
 const url=new URL(raw)
 if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('DATABASE_URL must be a PostgreSQL URL')
 if(process.env.APP_ENV==='production')return raw
 if(process.env.LOCAL_DATABASE_ONLY!=='true')throw new Error('Explicit LOCAL_DATABASE_ONLY=true is required during migration')
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.startsWith('/mavenhost_'))throw new Error('Migration development only accepts isolated loopback mavenhost_ databases')
 return raw
}
export function localPool(){return new pg.Pool({connectionString:localDatabaseUrl(),max:4,connectionTimeoutMillis:15000,idleTimeoutMillis:10000})}
