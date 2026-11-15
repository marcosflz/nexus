export const runtime = "nodejs";
function retired() { return Response.json({ error: "Agentes se ha sustituido por Skills y Nexbots" }, { status: 410 }); }
export const GET = retired;
export const POST = retired;
export const PATCH = retired;
export const DELETE = retired;
