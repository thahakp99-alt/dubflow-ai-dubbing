// Disabled staging only. No production entry point or environment is modified.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createApp} = require('../server');
const {inspectVideo} = require('../media-validation');
function validateConfig(env) {
  if (env.DUBBING_ENABLED !== 'false' || env.ELEVENLABS_API_KEY) throw Error('Staging requires dubbing disabled and no provider key.');
  if (!env.DUBFLOW_ACCESS_TOKEN || env.DUBFLOW_ACCESS_TOKEN.length<32) throw Error('Staging requires a private owner token of at least 32 characters.');
  const url=new URL(env.RENDER_EXTERNAL_URL || env.STAGING_ORIGIN);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname!=='/') throw Error('Invalid staging origin.');
  return url.origin;
}
async function checkMediaTools() {
  for (const binary of ['ffprobe','ffmpeg']) execFileSync(binary,['-version'],{stdio:'ignore',timeout:10000});
  await inspectVideo(path.join(__dirname,'../test/fixtures/mock-video.mp4'));
}
function createStagingApp(env=process.env,logger=console) {
  const origin=validateConfig(env);
  const app=express();
  app.get('/healthz',(_req,res)=>res.json({mode:'staging-disabled',dubbing_enabled:false}));
  app.get('/',(_req,res)=>{
    const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8')
      .replace(/const BACKEND = location.hostname[\s\S]*?: location.origin;/,'const BACKEND = location.origin;')
      .replace('<main>','<main><p><strong>STAGING — Dubbing disabled. No ElevenLabs calls.</strong></p>');
    res.set('Cache-Control','no-store').type('html').send(html);
  });
  app.use(createApp({apiKey:'',dubbingEnabled:false,accessToken:env.DUBFLOW_ACCESS_TOKEN,
    allowedOrigins:[origin],logger,fetchImpl:async()=>{throw Error('Provider access is disabled in staging.');}}));
  return app;
}
async function main() {
  validateConfig(process.env);
  await checkMediaTools(); // No listening/healthy instance if prerequisites fail.
  createStagingApp().listen(Number(process.env.PORT)||10000,'0.0.0.0',()=>console.log('Disabled staging ready; media tools checked.'));
}
if(require.main===module) main().catch(()=>{console.error('Staging startup failed: check configuration and media tools.');process.exitCode=1;});
module.exports={validateConfig,checkMediaTools,createStagingApp};
