import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
// This fixture is opt-in and runs ONLY in a loopback local process, never in an API route.
if(process.argv.includes('--synthetic')) {
  if(process.env.VERCEL) throw new Error('Synthetic mode is local only');
  process.env.NODE_ENV='test'; process.env.DATABASE_URL='synthetic-only';
  process.env.ENDEPTH_ADMIN_CODE=randomBytes(32).toString('base64url');
  process.env.ENDEPTH_TEACHER_CODE=randomBytes(32).toString('base64url');
  const {testDatabase}=await import('../tests/helpers.js'); await testDatabase();
  const {ensurePilotSchema}=await import('../server/submissions-db.js'); await ensurePilotSchema();
  await mkdir('test-results',{recursive:true});
  await writeFile('test-results/ui-credentials.json',JSON.stringify({adminCode:process.env.ENDEPTH_ADMIN_CODE}),{mode:0o600});
}
const vite=await createServer({server:{middlewareMode:true},appType:'spa'});
const handlers=new Map();
for(const name of ['staff-auth','teachers','department','assignments','assignment-public','submissions','submissions-list','coach'])handlers.set('/api/'+name,(await import('../api/'+name+'.js')).default);
http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(!pathname.startsWith('/api/'))return vite.middlewares(req,res,()=>{res.statusCode=404;res.end();});
  const handler=handlers.get(pathname);if(!handler){res.statusCode=404;return res.end();}
  try{
    const chunks=[];for await(const c of req)chunks.push(c);
    const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
    const response=await handler.fetch(request);res.statusCode=response.status;response.headers.forEach((v,k)=>res.setHeader(k,v));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.statusCode=500;res.end('Local request failed');}
}).listen(5173,'127.0.0.1',()=>console.log('Local full-stack server at http://localhost:5173 (synthetic mode has no live AI)'));
