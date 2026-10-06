import {readFile} from 'node:fs/promises'
import {localPool} from './database.mjs'
const plans=JSON.parse(await readFile(new URL('../server/db/seeds/hosting.json',import.meta.url),'utf8'))
const pool=localPool(),client=await pool.connect()
try{
 await client.query('BEGIN')
 await client.query('SELECT pg_advisory_xact_lock($1)',[84190922])
 for(const plan of plans){
  const {prices,...document}=plan
  await client.query('INSERT INTO hosting_plan(id,slug,name,plan_type,verification_status,document) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,plan_type=EXCLUDED.plan_type,verification_status=EXCLUDED.verification_status,document=EXCLUDED.document,updated_at=CURRENT_TIMESTAMP',[plan.id,plan.slug,plan.name,plan.plan_type,plan.verification_status,JSON.stringify(document)])
  for(const price of prices)await client.query('INSERT INTO hosting_plan_price(id,plan_id,billing_cycle,currency,price,regular_price,sale_price,setup_fee) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET plan_id=EXCLUDED.plan_id,billing_cycle=EXCLUDED.billing_cycle,currency=EXCLUDED.currency,price=EXCLUDED.price,regular_price=EXCLUDED.regular_price,sale_price=EXCLUDED.sale_price,setup_fee=EXCLUDED.setup_fee',[price.id,plan.id,price.billing_cycle,price.currency,price.price,price.regular_price,price.sale_price,price.setup_fee])
 }
 await client.query('COMMIT');console.log(`Seeded ${plans.length} approved public hosting configurations; activation remains pending.`)
}catch(error){await client.query('ROLLBACK');throw error}finally{client.release();await pool.end()}
