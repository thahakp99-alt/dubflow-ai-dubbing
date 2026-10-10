const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {validateConfig,checkMediaTools,createStagingApp}=require('../staging/server');
const env={DUBBING_ENABLED:'false',DUBFLOW_ACCESS_TOKEN:'staging-test-only-token-over-32-characters',STAGING_ORIGIN:'http://127.0.0.1:10000'};
const localFetch=globalThis.fetch;
globalThis.fetch=()=>{throw Error('No external network permitted');};
test('staging refuses enabled dubbing, provider key or absent token',()=>{
  for(const patch of [{DUBBING_ENABLED:'true'},{ELEVENLABS_API_KEY:'fake-test-key'},{DUBFLOW_ACCESS_TOKEN:''}])assert.throws(()=>validateConfig({...env,...patch}));
});
test('local staging preflight verifies both binaries and synthetic MP4',async()=>{await checkMediaTools();});
test('staging health, same-origin UI, blocked create and blocked status provider',async t=>{
  const app=createStagingApp(env,{warn(){}});const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await(await localFetch(base+'/healthz')).json()).dubbing_enabled,false);
  const html=await(await localFetch(base)).text();assert.match(html,/const BACKEND = location.origin;/);assert.ok(!html.includes('dubflow-ai-dubbing.onrender.com'));assert.ok(!html.includes(env.DUBFLOW_ACCESS_TOKEN));
  const headers={Authorization:'Bearer '+env.DUBFLOW_ACCESS_TOKEN};
  const created=await localFetch(base+'/api/dub',{method:'POST',headers});assert.equal(created.status,503);assert.equal((await created.json()).code,'dubbing_disabled');
  const status=await localFetch(base+'/api/jobs/example',{headers});assert.notEqual(status.status,200);
});
