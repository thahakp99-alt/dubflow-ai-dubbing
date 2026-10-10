const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createMockApp,MOCK_TOKEN}=require('../mock-server');
const localFetch=globalThis.fetch;
globalThis.fetch=()=>{throw Error('External network disabled');};
test('full local mock: upload, pending, dubbed, playable MP4 bytes, download headers',async t=>{
  const server=createMockApp({logger:{warn(){}}}).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const html=await(await localFetch(base)).text();assert.match(html,/LOCAL MOCK/);assert.match(html,/dubbedPreview/);
  const form=new FormData();const input=fs.readFileSync(path.join(__dirname,'fixtures/mock-video.mp4'));
  form.append('video',new Blob([input],{type:'video/mp4'}),'sample.mp4');form.append('source_lang','ml');form.append('target_lang','en');
  const headers={Authorization:'Bearer '+MOCK_TOKEN};
  const create=await localFetch(base+'/api/dub',{method:'POST',headers,body:form});assert.equal(create.status,200);
  const job=await create.json();headers['X-Job-Token']=job.job_token;
  for(const status of ['dubbing','dubbed']) {
    const response=await localFetch(base+'/api/jobs/'+job.dubbing_id,{headers});assert.equal((await response.json()).status,status);
  }
  const media=await localFetch(base+'/api/jobs/'+job.dubbing_id+'/media',{headers});assert.equal(media.status,200);
  const downloaded=Buffer.from(await media.arrayBuffer());
  const hash=b=>createHash('sha256').update(b).digest('hex');
  assert.equal(hash(downloaded),hash(input));assert.equal(downloaded.subarray(4,8).toString(),'ftyp');
  assert.equal(media.headers.get('content-type'),'video/mp4');assert.match(media.headers.get('content-disposition'),/attachment; filename="dubflow-en.mp4"/);
});
