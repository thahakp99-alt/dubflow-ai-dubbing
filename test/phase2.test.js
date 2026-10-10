const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createApp}=require('../server');
const localFetch=globalThis.fetch;
globalThis.fetch=()=>{throw Error('External calls forbidden');};
const TOKEN='mock-owner-token-longer-than-32-characters';
const j=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const mp4=Buffer.from('mock-mp4-bytes');
async function fixture(t,options={}) {
  const calls=[],logs=[];const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dubflow-p2-'));
  let state='dubbed';
  const {reply,...rest}=options;
  const app=createApp({inspectVideoImpl:async()=>({duration:20}),accessToken:TOKEN,apiKey:'MOCK-KEY',dubbingEnabled:true,uploadDir:dir,
    logger:{warn:v=>logs.push(v)},fetchImpl:async(url,opts)=>{
      calls.push([url,opts]);
      if(reply)return reply(url,opts);
      if(opts.method==='POST')return j({dubbing_id:'job-123'});
      if(url.endsWith('/audio/en'))return new Response(mp4,{headers:{'Content-Type':'video/mp4'}});
      return j({status:state,error:'MOCK-SECRET',name:'private name'});
    },...rest});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
  async function request(route,options={}){
    const {token=TOKEN,ticket,headers,...other}=options;
    return localFetch(origin+route,{...other,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(ticket?{'X-Job-Token':ticket}:{}),...headers}});
  }
  async function create(){const form=new FormData();form.append('video',new Blob(['mock'],{type:'video/mp4'}),'test.mp4');form.append('source_lang','ml');form.append('target_lang','en');return request('/api/dub',{method:'POST',body:form});}
  return {request,create,calls,logs,dir,state:value=>state=value};
}
for(const route of ['/api/dub','/api/jobs/job-123','/api/jobs/job-123/media']) {
  test('unauthenticated access blocked before upstream '+route,async t=>{const f=await fixture(t);const r=await f.request(route,{method:route==='/api/dub'?'POST':'GET',token:null});assert.equal(r.status,401);assert.equal(f.calls.length,0);assert.deepEqual(await fs.readdir(f.dir),[]);});
}
test('wrong token rejected and not logged',async t=>{const f=await fixture(t);const r=await f.request('/api/jobs/x',{token:'MOCK-SECRET'});assert.equal(r.status,401);assert.ok(!JSON.stringify(f.logs).includes('MOCK-SECRET'));});
test('missing access configuration fails closed',async t=>{const f=await fixture(t,{accessToken:''});assert.equal((await f.create()).status,503);assert.equal(f.calls.length,0);});
test('paid job creation disabled by switch',async t=>{const f=await fixture(t,{dubbingEnabled:false});const r=await f.create();assert.equal((await r.json()).code,'dubbing_disabled');assert.equal(f.calls.length,0);});
test('hostile Origin rejected even with correct token',async t=>{const f=await fixture(t);const r=await f.request('/api/jobs/x',{headers:{Origin:'https://evil.invalid'}});assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);assert.equal(f.calls.length,0);});
test('preflight allows auth headers only for approved site',async t=>{const f=await fixture(t);const r=await f.request('/api/jobs/x',{method:'OPTIONS',token:null,headers:{Origin:'https://thahakp99-alt.github.io','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization,x-job-token'}});assert.equal(r.status,204);assert.match(r.headers.get('access-control-allow-headers'),/X-Job-Token/);assert.equal(f.calls.length,0);});
test('create rate limit stops second upstream call',async t=>{const f=await fixture(t,{createLimit:1});assert.equal((await f.create()).status,200);const r=await f.create();assert.equal(r.status,429);assert.ok(r.headers.get('retry-after'));assert.equal(f.calls.length,1);});
test('read budget is enforced',async t=>{const f=await fixture(t,{readLimit:1});await f.request('/api/jobs/x');assert.equal((await f.request('/api/jobs/x')).status,429);assert.equal(f.calls.length,0);});
for(const status of ['queued','preparing','dubbing','dubbed','failed']) test('signed job status '+status,async t=>{
  const f=await fixture(t);const job=await (await f.create()).json();f.state(status);
  const r=await f.request('/api/jobs/job-123',{ticket:job.job_token});const data=await r.json();assert.equal(r.status,200);assert.equal(data.status,status);assert.equal(data.target_lang,'en');assert.ok(!JSON.stringify(data).includes('MOCK-SECRET'));assert.equal(r.headers.get('cache-control'),'no-store');
});
test('missing, tampered and foreign job tickets denied',async t=>{
  const f=await fixture(t);const job=await (await f.create()).json();
  for(const [id,ticket] of [['job-123',undefined],['job-123',job.job_token+'x'],['different',job.job_token]]) assert.equal((await f.request('/api/jobs/'+id,{ticket})).status,403);
  assert.equal(f.calls.length,1);
});
test('expired job ticket denied before provider',async t=>{let time=0;const f=await fixture(t,{now:()=>time});const job=await (await f.create()).json();time=8*86400000;assert.equal((await f.request('/api/jobs/job-123',{ticket:job.job_token})).status,403);assert.equal(f.calls.length,1);});
test('signed ticket survives server restart with same owner secret',async t=>{const a=await fixture(t),b=await fixture(t);const job=await(await a.create()).json();assert.equal((await b.request('/api/jobs/job-123',{ticket:job.job_token})).status,200);});
test('download is gated until dubbed and streams exact bytes with safe filename',async t=>{
  const f=await fixture(t);const job=await(await f.create()).json();f.state('dubbing');
  assert.equal((await f.request('/api/jobs/job-123/media',{ticket:job.job_token})).status,409);
  assert.equal(f.calls.some(([url])=>url.includes('/audio/')),false);
  f.state('dubbed');const r=await f.request('/api/jobs/job-123/media',{ticket:job.job_token});
  assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'video/mp4');assert.match(r.headers.get('content-disposition'),/dubflow-en.mp4/);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()),mp4);assert.equal(f.calls.at(-1)[0],'https://api.elevenlabs.io/v1/dubbing/job-123/audio/en');
});
for(const [name,media,code] of [
  ['HTML',()=>new Response('<html>MOCK-SECRET</html>',{headers:{'Content-Type':'text/html'}}),'invalid_media'],
  ['upstream error',()=>new Response('MOCK-SECRET',{status:403}),'media_unavailable'],
  ['oversize',()=>new Response(mp4,{headers:{'Content-Type':'video/mp4','Content-Length':'100'}}),'media_too_large']
])test('download '+name+' handled safely',async t=>{
  const f=await fixture(t,{maxDownloadBytes:20,reply:(url,opts)=>opts.method==='POST'?j({dubbing_id:'job-123'}):url.includes('/audio/')?media():j({status:'dubbed'})});
  const job=await(await f.create()).json();const r=await f.request('/api/jobs/job-123/media',{ticket:job.job_token});const data=await r.json();assert.equal(data.code,code);assert.ok(!JSON.stringify(data).includes('MOCK-SECRET'));
});
test('unknown length download exceeding cap is never delivered successfully',async t=>{
  const f=await fixture(t,{maxDownloadBytes:4});const job=await(await f.create()).json();
  await assert.rejects(async()=>{const r=await f.request('/api/jobs/job-123/media',{ticket:job.job_token});await r.arrayBuffer();});
});
test('malformed multipart returns safe JSON, process remains healthy',async t=>{
  const f=await fixture(t);const r=await f.request('/api/dub',{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=test'},body:'--test\r\nmalformed'});
  assert.equal(r.status,400);assert.ok((await r.json()).code);assert.equal(f.calls.length,0);assert.equal((await f.request('/')).status,200);
});
test('concurrent create rejected before second upstream invocation',async t=>{
  let release;const waiting=new Promise(r=>release=r);
  const f=await fixture(t,{reply:async()=>{await waiting;return j({dubbing_id:'job-123'});}});
  const first=f.create();
  for(let i=0;i<50 && f.calls.length===0;i++)await new Promise(r=>setTimeout(r,2));
  const second=await f.create();assert.equal(second.status,429);assert.equal((await second.json()).code,'upload_busy');
  release();assert.equal((await first).status,200);assert.equal(f.calls.length,1);
});
test('two files rejected without provider call or leftover uploads',async t=>{
  const f=await fixture(t);const form=new FormData();
  for(let i=0;i<2;i++)form.append('video',new Blob(['mock'],{type:'video/mp4'}),'x.mp4');
  const r=await f.request('/api/dub',{method:'POST',body:form});assert.equal(r.status,400);assert.equal(f.calls.length,0);
  assert.deepEqual(await fs.readdir(f.dir),[]);
});
