const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const job={dubbing_id:'mock-job',job_token:'mock-signed-ticket',target_lang:'en'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
function setup({file=new Blob(['test'],{type:'video/mp4'}),reply,stored=null,token='MOCK-ACCESS-TOKEN',delay=fn=>{fn();}}={}) {
  const calls=[],elements={},saved={},revoked=[];
  for(const id of ['videoFile','preview','status','source','target','start','resume','stop','accessToken','result','dubbedPreview','download','resultLabel']) {
    elements[id]={hidden:false,disabled:false,textContent:'',value:'',listeners:{},addEventListener(event,fn){this.listeners[event]=fn;},removeAttribute(name){delete this[name];},load(){}};
  }
  elements.videoFile.files=file?[file]:[];elements.source.value='ml';elements.target.value='en';elements.accessToken.value=token;
  let urls=0;
  const context={document:{getElementById:id=>elements[id]},location:{hostname:'127.0.0.1',origin:'http://127.0.0.1:10000'},
    sessionStorage:{getItem:()=>stored,setItem:(key,value)=>{saved[key]=value;}},
    window:{addEventListener(){}},setTimeout:delay,AbortController,FormData,TypeError,
    URL:{createObjectURL:()=>`blob:mock-${++urls}`,revokeObjectURL:url=>revoked.push(url)},
    fetch:async(url,options)=>{calls.push([url,options]);if(reply)return reply(url,options);
      if(url.endsWith('/api/dub'))return json(job);
      if(url.endsWith('/media'))return new Response('mock-mp4',{headers:{'Content-Type':'video/mp4'}});
      return json({status:'dubbed'});
    }};
  vm.runInNewContext(source,context);
  return {elements,calls,saved,revoked,click:id=>elements[id].listeners.click(),change:()=>elements.videoFile.listeners.change()};
}
test('upload -> status -> preview -> download, with header-only auth and local URL',async()=>{
  const f=setup();await f.click('start');assert.equal(f.calls.length,3);
  assert.equal(f.calls[0][0],'http://127.0.0.1:10000/api/dub');
  assert.equal(f.calls[0][1].body.get('source_lang'),'ml');assert.equal(f.calls[0][1].body.get('target_lang'),'en');
  for(const [url,opts] of f.calls){assert.equal(opts.headers.Authorization,'Bearer MOCK-ACCESS-TOKEN');assert.ok(!url.includes('TOKEN'));}
  assert.equal(f.calls[1][1].headers['X-Job-Token'],job.job_token);
  assert.equal(f.elements.result.hidden,false);assert.match(f.elements.dubbedPreview.src,/^blob:/);
  assert.equal(f.elements.download.href,f.elements.dubbedPreview.src);assert.equal(f.elements.download.download,'dubflow-en.mp4');
  assert.ok(!JSON.stringify(f.saved).includes('MOCK-ACCESS-TOKEN'));assert.equal(f.elements.start.disabled,false);
});
test('dubbing status polls until ready without repeating POST',async()=>{
  let checks=0;const f=setup({reply:async url=>url.endsWith('/api/dub')?json(job):url.endsWith('/media')?new Response('mp4',{headers:{'Content-Type':'video/mp4'}}):json({status:++checks===1?'dubbing':'dubbed'})});
  await f.click('start');assert.equal(checks,2);assert.equal(f.calls.filter(([,o])=>o.method==='POST').length,1);
});
test('resume saved job performs no upload',async()=>{const f=setup({stored:JSON.stringify(job)});await f.click('resume');assert.equal(f.calls.length,2);assert.ok(f.calls.every(([,o])=>o.method!=='POST'));});
test('failed job stops polling and does not retrieve media',async()=>{const f=setup({reply:async url=>json(url.endsWith('/api/dub')?job:{status:'failed',error:'MOCK-SECRET'})});await f.click('start');assert.equal(f.calls.length,2);assert.match(f.elements.status.textContent,/പരാജയപ്പെട്ടു/);assert.ok(!f.elements.status.textContent.includes('MOCK-SECRET'));});
test('polling bounded at 120 checks and can resume',async()=>{const f=setup({reply:async url=>json(url.endsWith('/api/dub')?job:{status:'dubbing'})});await f.click('start');assert.equal(f.calls.length,121);assert.equal(f.elements.resume.hidden,false);assert.equal(f.elements.start.disabled,false);});
test('stop aborts request and suppresses stale results',async()=>{
  let resolve;const f=setup({reply:()=>new Promise(r=>resolve=r)});const pending=f.click('start');await f.click('stop');
  assert.equal(f.calls[0][1].signal.aborted,true);resolve(json(job));await pending;
  assert.equal(f.calls.length,1);assert.equal(f.elements.result.hidden,true);assert.match(f.elements.status.textContent,/നിർത്തി/);
});
test('duplicate clicks cannot create two jobs',async()=>{let resolve;const f=setup({reply:()=>new Promise(r=>resolve=r)});const pending=f.click('start');await f.click('start');assert.equal(f.calls.length,1);await f.click('stop');resolve(json(job));await pending;});
for(const [name,file,token] of [['no file',null,'token'],['oversize',{size:100*1024*1024+1,type:'video/mp4'},'token'],['wrong MIME',new Blob(['x'],{type:'text/plain'}),'token'],['no token',new Blob(['x'],{type:'video/mp4'}),'']])test(name+' makes zero requests',async()=>{const f=setup({file,token});await f.click('start');assert.equal(f.calls.length,0);});
for(const [name,reply,pattern] of [
 ['safe provider error',async()=>json({error:'Insufficient credits',code:'quota_exceeded',request_id:'00000000-0000-0000-0000-000000000000'},402),/HTTP 402.*quota_exceeded.*Reference/],
 ['raw detail',async()=>json({detail:{message:'MOCK-SECRET'}},400),/HTTP 400/],
 ['HTML',async()=>new Response('<html>MOCK-SECRET</html>',{status:502}),/HTTP 502/],
 ['missing job ID',async()=>json({}),/job reference/],
 ['network',async()=>{throw new TypeError('MOCK-SECRET')},/ElevenLabs history/],
])test(name+' handled and button recovers',async()=>{const f=setup({reply});await f.click('start');assert.match(f.elements.status.textContent,pattern);assert.equal(f.elements.start.disabled,false);assert.ok(!f.elements.status.textContent.includes('MOCK-SECRET'));});
test('download error keeps saved job for retry without new upload',async()=>{const f=setup({reply:async url=>url.endsWith('/api/dub')?json(job):url.endsWith('/media')?json({error:'Media unavailable'},502):json({status:'dubbed'})});await f.click('start');assert.match(f.elements.status.textContent,/Media unavailable/);assert.equal(f.elements.resume.hidden,false);assert.equal(f.elements.result.hidden,true);});
test('audio provider output uses mp3 filename',async()=>{const f=setup({reply:async url=>url.endsWith('/api/dub')?json(job):url.endsWith('/media')?new Response('mp3',{headers:{'Content-Type':'audio/mpeg'}}):json({status:'dubbed'})});await f.click('start');assert.equal(f.elements.download.download,'dubflow-en.mp3');});
test('new preview revokes previous blob URL',async()=>{const f=setup();f.change();const first=f.elements.preview.src;f.change();assert.ok(f.revoked.includes(first));});
