import {database} from '../../../../server/db'
export const runtime='nodejs'
export async function GET(){try{await database().query('SELECT 1');return Response.json({status:'ok',database:'connected',migration:'in_progress'},{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({status:'unavailable',database:'unavailable'},{status:503,headers:{'Cache-Control':'no-store'}})}}
