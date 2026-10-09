import {randomUUID} from 'node:crypto'
import type {Pool,PoolClient} from 'pg'
export type OutboxEvent={id:string;event_id:string;event_name:string;payload:Record<string,unknown>;attempts:number;locked_at:Date}
export async function enqueueOutbox(client:PoolClient,event:{eventId:string;name:string;payload:Record<string,unknown>;occurredAt:Date},dedupeKey:string|null=null){
 // The Django schema has no column defaults, so every value is supplied as the ORM did.
 return (await client.query<OutboxEvent>(`INSERT INTO core_events_outbox(id,event_id,occurred_at,event_name,payload,dedupe_key,status,attempts,available_at,last_error,created_at,updated_at)
 VALUES($1,$2,$3,$4,$5,$6,'pending',0,CURRENT_TIMESTAMP,'',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(dedupe_key) DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key RETURNING *`,[randomUUID(),event.eventId,event.occurredAt,event.name,JSON.stringify(event.payload),dedupeKey])).rows[0]
}
export async function claimOutbox(pool:Pool):Promise<OutboxEvent|null>{
 const client=await pool.connect()
 try{
  await client.query('BEGIN')
  await client.query(`UPDATE core_events_outbox SET status='pending',locked_at=NULL,available_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE status='processing' AND locked_at<CURRENT_TIMESTAMP-INTERVAL '15 minutes'`)
  const event=(await client.query<OutboxEvent>(`SELECT * FROM core_events_outbox WHERE status IN ('pending','failed') AND available_at<=CURRENT_TIMESTAMP ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0]
  if(!event){await client.query('COMMIT');return null}
  const claimed=(await client.query<OutboxEvent>(`UPDATE core_events_outbox SET status='processing',locked_at=CURRENT_TIMESTAMP,attempts=attempts+1,last_error='',updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,[event.id])).rows[0]
  await client.query('COMMIT');return claimed
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
export async function finishOutbox(pool:Pool,event:OutboxEvent,success:boolean):Promise<boolean>{
 // Fence completion by claim attempt so a stale worker cannot finish a reclaimed event.
 const delay=Math.min(2**Math.min(Math.max(event.attempts-1,0),6),60)
 const result=success?await pool.query(`UPDATE core_events_outbox SET status='completed',processed_at=CURRENT_TIMESTAMP,locked_at=NULL,last_error='',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='processing' AND attempts=$2`,[event.id,event.attempts]):await pool.query(`UPDATE core_events_outbox SET status='failed',available_at=CURRENT_TIMESTAMP+($3::integer*INTERVAL '1 minute'),locked_at=NULL,last_error='handler_failed',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='processing' AND attempts=$2`,[event.id,event.attempts,delay])
 return result.rowCount===1
}
export async function processOutbox(pool:Pool,handlers:ReadonlyMap<string,(event:OutboxEvent)=>Promise<void>>,limit=50):Promise<number>{
 if(!Number.isInteger(limit)||limit<1||limit>500)throw new Error('Batch limit must be between 1 and 500')
 let completed=0
 for(let i=0;i<limit;i++){
  const event=await claimOutbox(pool);if(!event)break
  const handler=handlers.get(event.event_name)
  try{if(!handler)throw new Error('Unknown event type');await handler(event);if(await finishOutbox(pool,event,true))completed++}catch(error){console.error(`Outbox event ${event.id} (${event.event_name}) failed on attempt ${event.attempts}`,error);await finishOutbox(pool,event,false)}
 }
 return completed
}
