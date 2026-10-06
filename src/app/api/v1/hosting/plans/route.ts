import {database} from '../../../../../../server/db'
export const runtime='nodejs'
export async function GET(request:Request){
 const currency=new URL(request.url).searchParams.get('currency')||'USD'
 if(!/^[A-Z]{3}$/.test(currency))return Response.json({message:'Invalid currency.'},{status:400})
 try{
  const plans=(await database().query('SELECT id,document FROM hosting_plan ORDER BY (document->>\'display_order\')::integer,id')).rows
  const prices=(await database().query('SELECT id,plan_id,billing_cycle,currency,price,regular_price,sale_price,setup_fee FROM hosting_plan_price WHERE currency=$1 ORDER BY id',[currency])).rows
  return Response.json(plans.map(plan=>({...plan.document,prices:prices.filter(price=>price.plan_id===plan.id).map(price=>({id:price.id,billing_cycle:price.billing_cycle,currency:price.currency,price:price.price,regular_price:price.regular_price,sale_price:price.sale_price,setup_fee:price.setup_fee}))})),{headers:{'Cache-Control':'no-store'}})
 }catch{return Response.json({message:'The hosting catalog is temporarily unavailable.'},{status:503})}
}
