import { PGlite } from '@electric-sql/pglite';
import { setTestSql } from '../server/db.js';
export async function testDatabase() {
  const db=new PGlite();
  const sql=async (parts,...params)=> (await db.query(parts.reduce((s,p,i)=>s+(i?'$'+i:'')+p,''),params)).rows;
  setTestSql(sql);
  return {db,sql};
}
export function req(body,cookie='',origin='https://example.test',path='/api/department') {
  return new Request('https://example.test'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:JSON.stringify(body)});
}
export async function send(handler,body,cookie='',origin) {
  const response=await handler.fetch(req(body,cookie,origin));
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
