export async function department(body,path='/api/department') {
  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.error || 'The request could not be completed.');
  return d;
}
export function downloadCsv(csv) {
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='writing-records.csv';a.click();URL.revokeObjectURL(url);
}
