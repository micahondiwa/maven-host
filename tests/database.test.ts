import {describe,it,expect,beforeAll,afterAll,beforeEach} from 'vitest'
import {Pool} from 'pg'
import {randomUUID} from 'node:crypto'
import {enqueueOutbox,claimOutbox,finishOutbox,processOutbox} from '../server/jobs/outbox'
const url=process.env.TEST_DATABASE_URL
const suite=url?describe:describe.skip
suite('PostgreSQL outbox integrity',()=>{
 let pool:Pool
 beforeAll(async()=>{const parsed=new URL(url!);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||!parsed.pathname.startsWith('/mavenhost_'))throw new Error('Only isolated local test databases allowed');pool=new Pool({connectionString:url,max:8});await pool.query('SHOW server_version_num')})
 beforeEach(async()=>{await pool.query('DELETE FROM core_events_outbox')})
 afterAll(async()=>{await pool?.end()})
 async function enqueue(key:string){const client=await pool.connect();try{return await enqueueOutbox(client,{eventId:randomUUID(),name:'test.event',payload:{synthetic:true},occurredAt:new Date()},key)}finally{client.release()}}
 it('deduplicates an event in an atomic caller transaction',async()=>{const first=await enqueue('test:dedupe');const second=await enqueue('test:dedupe');expect(second.id).toBe(first.id);const client=await pool.connect();try{await client.query('BEGIN');await enqueueOutbox(client,{eventId:randomUUID(),name:'test.event',payload:{},occurredAt:new Date()},'rolled-back');await client.query('ROLLBACK')}finally{client.release()};expect((await pool.query('SELECT count(*)::integer AS n FROM core_events_outbox')).rows[0].n).toBe(1)})
 it('concurrent workers claim distinct events',async()=>{for(let i=0;i<8;i++)await enqueue(`test:concurrent:${i}`);const events=await Promise.all(Array.from({length:8},()=>claimOutbox(pool)));expect(new Set(events.map(e=>e!.id)).size).toBe(8);expect(await claimOutbox(pool)).toBe(null)})
 it('recovers stale claims and rejects stale completion',async()=>{await enqueue('test:stale');const old=(await claimOutbox(pool))!;await pool.query(`UPDATE core_events_outbox SET locked_at=CURRENT_TIMESTAMP-INTERVAL '16 minutes' WHERE id=$1`,[old.id]);const current=(await claimOutbox(pool))!;expect(current.attempts).toBe(2);expect(await finishOutbox(pool,old,true)).toBe(false);expect(await finishOutbox(pool,current,true)).toBe(true)})
 it('retries with persisted backoff and redacted errors',async()=>{await enqueue('test:retry');const count=await processOutbox(pool,new Map([['test.event',async()=>{throw new Error('sensitive-provider-detail')}]]),1);expect(count).toBe(0);const row=(await pool.query('SELECT status,attempts,last_error,available_at>CURRENT_TIMESTAMP AS delayed FROM core_events_outbox')).rows[0];expect(row).toMatchObject({status:'failed',attempts:1,last_error:'handler_failed',delayed:true});expect(await claimOutbox(pool)).toBe(null)})
 it('catalog amounts remain exact in PostgreSQL after the 20i lineup migration',async()=>{expect((await pool.query('SELECT count(*)::integer AS n FROM hosting_hostingplan WHERE is_active')).rows[0].n).toBe(18);expect((await pool.query('SELECT count(*)::integer AS n FROM hosting_hostingplanprice p JOIN hosting_hostingplan pl ON pl.id=p.hosting_plan_id WHERE p.is_active AND pl.is_active')).rows[0].n).toBe(33);expect((await pool.query('SELECT regular_price,sale_price FROM hosting_hostingplanprice WHERE id=9')).rows[0]).toEqual({regular_price:'142.03',sale_price:'112.13'})})
})
