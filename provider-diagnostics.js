// Deliberately project the error body: arbitrary messages, input, ctx, headers,
// file names and unknown properties must never be copied into logs.
const fields=new Set(['body','file','source_lang','target_lang','num_speakers','watermark']);
const types=new Set(['missing','int_parsing','bool_parsing','string_type','value_error','literal_error']);
const reasons=[['codec',/codec/i],['format',/format|container/i],['language',/language/i],
  ['speakers',/speaker/i],['audio',/audio/i],['empty_file',/empty file/i]];
function diagnostics(data,headers,secrets=[]) {
  const containsSecret=value=>secrets.filter(Boolean).some(s=>value.includes(s.trim()));
  const safeId=value=>typeof value==='string' && /^[a-zA-Z0-9-]{8,128}$/.test(value) && !containsSecret(value)?value:undefined;
  const ids={};
  for(const name of ['request-id','x-request-id','trace-id','x-trace-id']) {
    const value=safeId(headers?.get(name)); if(value)ids[name]=value;
  }
  const detail=data?.detail;
  const items=Array.isArray(detail)?detail.slice(0,10):[detail];
  const errors=items.map(item=>{
    const result={};
    const code=item?.status || item?.code;
    // Symbolic provider codes only, bounded and checked against server secrets.
    if(typeof code==='string' && /^[a-z][a-z_]{1,63}$/.test(code) && !containsSecret(code)) result.code=code;
    if(types.has(item?.type)) result.type=item.type;
    if(Array.isArray(item?.loc)) result.fields=item.loc.filter(x=>fields.has(x)).slice(0,8);
    const message=typeof item==='string'?item:item?.message || item?.msg;
    if(typeof message==='string' && !containsSecret(message)) {
      result.categories=reasons.filter(([,pattern])=>pattern.test(message)).map(([name])=>name);
    }
    return result;
  });
  return {providerReferences:ids,providerErrorBody:{format:data===undefined?'non_json':'json',errors,
    freeTextOmitted:true}};
}
module.exports={diagnostics};
