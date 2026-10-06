export const runtime='nodejs'
function unavailable(){return Response.json({message:'This operation is not available in the local migration build.',code:'migration_in_progress'},{status:503,headers:{'Cache-Control':'no-store'}})}
export const GET=unavailable
export const POST=unavailable
export const PATCH=unavailable
export const PUT=unavailable
export const DELETE=unavailable
