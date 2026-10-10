const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {diagnostics}=require('../provider-diagnostics');
const {inspectVideo,validateMetadata}=require('../media-validation');
test('user-reported original MP4 metadata passes production validator',()=>{
  // Reconstructed from the user's report, not a fresh probe of the original file.
  const metadata=require('./fixtures/reported-original-metadata.json');
  assert.deepEqual(validateMetadata(metadata),{duration:20.05});
});
test('actual synthetic MP4 has readable video/audio and positive duration',async()=>{
  const data=await inspectVideo(path.join(__dirname,'fixtures/mock-video.mp4'));
  assert.ok(data.duration>0);
});
for(const streams of [[],[{codec_type:'video',codec_name:'h264'}],[{codec_type:'audio',codec_name:'aac'}]])
 test('missing audio/video streams are rejected',()=>assert.throws(()=>validateMetadata({format:{format_name:'mp4',duration:20},streams})));
test('validation body projection preserves field/type, excludes echoed input and arbitrary secrets',()=>{
  const secret='secret-value-12345';
  const d=diagnostics({detail:[{type:'int_parsing',loc:['body','num_speakers',secret],msg:secret,input:secret,ctx:{secret}}]},new Headers({'request-id':secret,'x-trace-id':'abc123def456'}),[secret]);
  assert.deepEqual(d.providerErrorBody.errors[0],{type:'int_parsing',fields:['body','num_speakers']});
  assert.equal(d.providerReferences['x-trace-id'],'abc123def456');assert.ok(!JSON.stringify(d).includes(secret));
});
test('non JSON and hostile identifiers omitted; diagnostics bounded',()=>{
  const d=diagnostics(undefined,new Headers({'request-id':'Bearer private-secret'}));
  assert.deepEqual(d.providerReferences,{});assert.equal(d.providerErrorBody.format,'non_json');
  const many=diagnostics({detail:Array(100).fill({msg:'secret',input:'secret'})},new Headers());
  assert.equal(many.providerErrorBody.errors.length,10);assert.ok(!JSON.stringify(many).includes('secret'));
});
