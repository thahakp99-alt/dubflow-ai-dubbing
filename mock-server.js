// Local-only demonstration. No ElevenLabs calls and no real credentials.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const {createApp} = require('./server');
const MOCK_TOKEN = 'dubflow-local-demo-token-not-a-real-secret';
function createMockApp({logger=console}={}) {
  const jobs=new Map();
  const bytes=fs.readFileSync(path.join(__dirname,'test/fixtures/mock-video.mp4'));
  const app=express();
  app.get('/',(req,res)=>{
    const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8')
      .replace('<main>','<main><p><strong>LOCAL MOCK — credits ഉപയോഗിക്കുന്നില്ല. Output ഒരു test video ആണ്; യഥാർത്ഥ dubbing അല്ല.</strong></p>')
      .replace('id="accessToken"','id="accessToken" value="'+MOCK_TOKEN+'"');
    res.type('html').send(html);
  });
  app.use(createApp({apiKey:'MOCK_ONLY',accessToken:MOCK_TOKEN,dubbingEnabled:true,logger,
    allowedOrigins:['http://127.0.0.1:10000','http://localhost:10000'],
    fetchImpl:async(url,options)=>{
      const json=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
      if(options.method==='POST') {
        const id='mock-'+(jobs.size+1);jobs.set(id,{checks:0,target:options.body.get('target_lang')});
        return json({dubbing_id:id,expected_duration_sec:2});
      }
      const match=url.match(/\/v1\/dubbing\/(mock-\d+)(?:\/audio\/([a-z]{2,3}))?$/);
      const job=match && jobs.get(match[1]);
      if(!job)return new Response('{}',{status:404});
      if(match[2])return new Response(bytes,{headers:{'Content-Type':'video/mp4','Content-Length':String(bytes.length)}});
      return json({status:++job.checks<2?'dubbing':'dubbed'});
    }}));
  return app;
}
if(require.main===module) {
  createMockApp().listen(10000,'127.0.0.1',()=>console.log('Local mock only: http://127.0.0.1:10000 — no paid API calls.'));
}
module.exports={createMockApp,MOCK_TOKEN};
