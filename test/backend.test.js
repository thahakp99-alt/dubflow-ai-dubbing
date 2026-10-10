const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createApp } = require('../server');

// Real fetch is used ONLY for the loopback test server. The production default
// fetch is disabled. Every upstream call is handled by an injected fake.
const loopbackFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('External fetch disabled in tests'); };
const ACCESS = 'mock-access-token-at-least-32-characters';
const FAKE_KEY = 'MOCK_ONLY_NOT_A_REAL_KEY';
const json = (body, status=200) => new Response(JSON.stringify(body), {status});
async function fixture(t, options={}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dubflow-test-'));
  const logs = [];
  const calls = [];
  const { reply, ...overrides } = options;
  const app = createApp({ inspectVideoImpl:async()=>({duration:20}), apiKey: FAKE_KEY, accessToken:ACCESS, dubbingEnabled:true, dubbingWatermark:'true', uploadDir: dir,
    logger: {warn: value => logs.push(value)},
    fetchImpl: async (...args) => {
      calls.push(args);
      return reply ? reply(...args) : json({dubbing_id:'mock-job',expected_duration_sec:20});
    }, ...overrides });
  const server = app.listen(0, '127.0.0.1');
  await once(server,'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    await fs.rm(dir,{recursive:true,force:true});
  });
  return {logs,calls,dir, async request(form, method='POST', pathname='/api/dub') {
    const response = await loopbackFetch(base+pathname, {method,
      headers:{Origin:'https://thahakp99-alt.github.io',Authorization:'Bearer '+ACCESS},
      ...(form ? {body:form} : {})});
    const data = await response.json();
    return {response,data};
  }};
}
function video({source='ml',target='en',type='video/mp4',size=8,field='video'}={}) {
  const f = new FormData();
  f.append(field,new Blob([new Uint8Array(size)],{type}),'sample.mp4');
  if(source!==null) f.append('source_lang',source);
  if(target!==null) f.append('target_lang',target);
  return f;
}
async function cleaned(dir) {
  for(let i=0;i<20;i++) {
    if((await fs.readdir(dir)).length===0) return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.deepEqual(await fs.readdir(dir),[],'Temporary upload must be removed');
}

test('reported original size and metadata pass upload and reach only injected provider',async t=>{
  const metadata=require('./fixtures/reported-original-metadata.json');
  const {validateMetadata}=require('../media-validation');
  let inspections=0;
  const f=await fixture(t,{inspectVideoImpl:async filename=>{
    inspections++;
    assert.equal((await fs.stat(filename)).size,Number(metadata.format.size));
    return validateMetadata(metadata);
  }});
  // Synthetic bytes of the reported size; original media bytes are NOT decoded here.
  const result=await f.request(video({size:Number(metadata.format.size)}));
  assert.equal(result.response.status,200);
  assert.equal(inspections,1);assert.equal(f.calls.length,1);
  const body=f.calls[0][1].body;
  assert.equal(body.get('file').size,4856380);
  assert.equal(body.get('source_lang'),'ml');assert.equal(body.get('target_lang'),'en');
  assert.equal(body.get('num_speakers'),'0');
  await cleaned(f.dir);
});

test('health and CORS response', async t=>{
  const f=await fixture(t); const {response,data}=await f.request(null,'GET','/');
  assert.equal(response.status,200); assert.equal(response.headers.get('access-control-allow-origin'),'https://thahakp99-alt.github.io');
  assert.equal(data.message,'DubFlow backend is running'); assert.equal(f.calls.length,0);
});
test('multipart video and ml/en reach the mock; success has only permitted fields',async t=>{
  const f=await fixture(t,{reply:()=>json({dubbing_id:'mock-job',expected_duration_sec:20,secret:FAKE_KEY})});
  const {response,data}=await f.request(video());
  assert.equal(response.status,200); assert.equal(data.dubbing_id,'mock-job'); assert.equal(data.expected_duration_sec,20); assert.equal(data.target_lang,'en'); assert.ok(data.job_token); assert.equal(data.secret,undefined);
  assert.equal(f.calls.length,1);
  const [url,opts]=f.calls[0];
  assert.equal(url,'https://api.elevenlabs.io/v1/dubbing');
  assert.equal(opts.body.get('source_lang'),'ml'); assert.equal(opts.body.get('target_lang'),'en');
  assert.equal(opts.body.get('file').size,8); assert.equal(opts.body.get('file').name,'sample.mp4');
  assert.equal(opts.body.get('num_speakers'),'0'); assert.equal(opts.headers['xi-api-key'],FAKE_KEY);
  assert.equal(opts.body.get('watermark'),'true');
  await cleaned(f.dir);
});
test('omitted language fields use auto/en',async t=>{
  const f=await fixture(t); await f.request(video({source:null,target:null}));
  assert.equal(f.calls[0][1].body.get('source_lang'),'auto');
  assert.equal(f.calls[0][1].body.get('target_lang'),'en'); await cleaned(f.dir);
});
test('both watermark choices serialize without inferred plan restrictions',async t=>{
  for (const choice of ['true','false']) {
    const f=await fixture(t,{dubbingWatermark:choice});
    assert.equal((await f.request(video())).response.status,200);
    assert.equal(f.calls[0][1].body.get('watermark'),choice);
    assert.equal(f.calls.length,1);
  }
});
test('invalid watermark configuration fails before provider call',async t=>{
  const f=await fixture(t,{dubbingWatermark:'yes'});
  const result=await f.request(video());
  assert.equal(result.response.status,503);
  assert.equal(result.data.code,'invalid_watermark_configuration');
  assert.equal(f.calls.length,0);
  await cleaned(f.dir);
});
for(const [name,form,options,status,code] of [
  ['no file',()=>null,{},400,'video_required'],
  ['missing key',()=>video(),{apiKey:''},503,'api_key_not_configured'],
  ['blank key',()=>video(),{apiKey:'   '},503,'api_key_not_configured'],
  ['invalid source',()=>video({source:'not-a-code'}),{},400,'invalid_language'],
  ['invalid target auto',()=>video({target:'auto'}),{},400,'invalid_language'],
  ['wrong upload field',()=>video({field:'file'}),{},400,'invalid_upload'],
  ['non-video MIME',()=>video({type:'text/plain'}),{},400,'invalid_upload'],
  ['oversize upload',()=>video({size:64}),{maxFileSize:16},413,'video_too_large'],
]) test(name+' rejects without upstream call',async t=>{
  const f=await fixture(t,options); const {response,data}=await f.request(form());
  assert.equal(response.status,status); assert.equal(data.code,code); assert.equal(f.calls.length,0);
  assert.match(data.request_id,/^[a-f0-9-]{36}$/); await cleaned(f.dir);
});
for(const [status,code] of [[400,'subscription_required'],[400,'quota_exceeded'],[400,'missing_permissions'],[401,'invalid_api_key'],[402,'quota_exceeded'],[403,'missing_permissions'],[429,'rate_limit_exceeded']]) {
  test('provider '+code+' safely reaches UI and log',async t=>{
    const f=await fixture(t,{reply:()=>json({detail:{status:code,message:FAKE_KEY}},status)});
    const {response,data}=await f.request(video());
    assert.equal(response.status,status); assert.equal(data.code,code); assert.equal(data.upstream_status,status);
    assert.equal(f.logs[0].requestId,data.request_id);
    assert.ok(!JSON.stringify([data,f.logs]).includes(FAKE_KEY)); await cleaned(f.dir);
  });
}
for(const [name,reply,status,code] of [
  ['HTML upstream failure',()=>new Response('<html>'+FAKE_KEY+'</html>',{status:502}),502,'provider_error'],
  ['validation array',()=>json({detail:[{msg:FAKE_KEY,input:FAKE_KEY}]},422),422,'provider_validation_error'],
  ['unknown sensitive status',()=>json({detail:{status:FAKE_KEY,message:FAKE_KEY}},400),400,'provider_bad_request'],
  ['invalid success JSON',()=>new Response('not-json '+FAKE_KEY),502,'invalid_provider_response'],
  ['missing job ID',()=>json({message:FAKE_KEY}),502,'invalid_provider_response'],
  ['null success',()=>json(null),502,'invalid_provider_response'],
  ['network failure',()=>{throw new TypeError(FAKE_KEY)},502,'provider_connection_error'],
  ['timeout',()=>{throw new DOMException(FAKE_KEY,'TimeoutError')},504,'provider_timeout'],
]) test(name+' handled without raw secret leakage or retry',async t=>{
  const f=await fixture(t,{reply}); const {response,data}=await f.request(video());
  assert.equal(response.status,status); assert.equal(data.code,code); assert.equal(f.calls.length,1);
  assert.ok(!JSON.stringify([data,f.logs]).includes(FAKE_KEY)); await cleaned(f.dir);
});
test('actual AbortSignal deadline reaches mocked fetch',async t=>{
  const f=await fixture(t,{timeoutMs:10,reply:(_url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  })});
  const {response,data}=await f.request(video());
  assert.equal(response.status,504); assert.equal(data.code,'provider_timeout');
  assert.equal(f.calls.length,1); await cleaned(f.dir);
});

test('invalid media is rejected by real ffprobe before upstream and cleaned',async t=>{
  const {inspectVideo}=require('../media-validation');
  const f=await fixture(t,{inspectVideoImpl:inspectVideo});
  const result=await f.request(video());
  assert.equal(result.response.status,400);
  assert.equal(result.data.code,'invalid_video_media');
  assert.equal(f.calls.length,0); await cleaned(f.dir);
});
test('missing ffprobe fails closed without upstream',async t=>{
  const f=await fixture(t,{inspectVideoImpl:async()=>{throw {code:'media_inspector_unavailable'};}});
  const result=await f.request(video());
  assert.equal(result.response.status,503); assert.equal(f.calls.length,0); await cleaned(f.dir);
});
for(const form of [()=>video({source:''}),()=>video({target:''}),()=>video({target:'zz'}),()=>{
  const f=video();f.append('source_lang','en');return f;
}]) test('empty, unsupported or duplicate language rejected before upstream',async t=>{
  const f=await fixture(t); const r=await f.request(form());assert.equal(r.response.status,400);assert.equal(f.calls.length,0);
});
test('binary MIME video is inspected then passed through once',async t=>{
  let inspections=0;
  const f=await fixture(t,{inspectVideoImpl:async()=>{inspections++;}});
  assert.equal((await f.request(video({type:'application/octet-stream'}))).response.status,200);
  assert.equal(inspections,1);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0][1].headers['Content-Type'],undefined,'FormData must generate its own boundary');
});
test('400 diagnostics correlate provider ID to UI reference without raw body or secrets',async t=>{
  const f=await fixture(t,{reply:()=>new Response(JSON.stringify({detail:{
    status:'invalid_video',message:'Unsupported video codec',input:FAKE_KEY,token:ACCESS
  },secret:FAKE_KEY}),{status:400,headers:{'request-id':'trace-12345678','authorization':FAKE_KEY}})});
  const r=await f.request(video()); const log=f.logs[0];
  assert.equal(log.requestId,r.data.request_id);assert.equal(log.providerReferences['request-id'],'trace-12345678');
  assert.equal(log.providerErrorBody.errors[0].code,'invalid_video');
  assert.deepEqual(log.providerErrorBody.errors[0].categories,['codec']);
  assert.equal(r.data.providerErrorBody,undefined);
  assert.ok(!JSON.stringify(f.logs).includes(FAKE_KEY));assert.ok(!JSON.stringify(f.logs).includes(ACCESS));
  assert.equal(f.calls.length,1);
});
