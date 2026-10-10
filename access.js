const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest();
const equal = (a,b) => timingSafeEqual(digest(a),digest(b));
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function createAccess({ token, origins, fail, now=Date.now, createLimit=6, readLimit=120 }) {
  const secret = typeof token === 'string' ? token : '';
  const buckets = new Map(); // Fixed number of global buckets; no unbounded IP map.
  function allow(key,limit,windowMs,res) {
    let bucket=buckets.get(key);
    if(!bucket || now()>=bucket.until) {bucket={count:0,until:now()+windowMs};buckets.set(key,bucket);}
    if(++bucket.count>limit) {
      res.set('Retry-After',String(Math.max(1,Math.ceil((bucket.until-now())/1000))));
      fail(res,429,'request_limit','Request limit reached. Try later.');return false;
    }
    return true;
  }
  function middleware(req,res,next) {
    res.set('Cache-Control','no-store');
    if(req.get('Origin') && !origins.includes(req.get('Origin'))) return fail(res,403,'origin_denied','This website is not allowed.');
    if(secret.length<32) return fail(res,503,'access_not_configured','Server access control is not configured.');
    const supplied=req.get('Authorization') || '';
    if(!supplied.startsWith('Bearer ') || !equal(supplied.slice(7),secret)) {
      if(!allow('unauthorized',60,60000,res)) return;
      return fail(res,401,'unauthorized','Enter the DubFlow access token.');
    }
    if(!allow('reads',readLimit,60000,res)) return;
    next();
  }
  function createGuard(req,res,next) {
    if(allow('creates',createLimit,3600000,res)) next();
  }
  function ticket(id,target) {
    const payload=Buffer.from(JSON.stringify({id,target,expires:now()+7*86400000})).toString('base64url');
    return payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');
  }
  function jobGuard(req,res,next) {
    try {
      const raw=req.get('X-Job-Token') || '';
      if(raw.length>1024 || !validId(req.params.id)) throw Error();
      const [payload,sig,extra]=raw.split('.');
      if(!payload || !sig || extra || !equal(sig,createHmac('sha256',secret).update(payload).digest('base64url'))) throw Error();
      const job=JSON.parse(Buffer.from(payload,'base64url').toString());
      if(job.id!==req.params.id || !/^[a-z]{2,3}$/.test(job.target) || !Number.isFinite(job.expires) || job.expires<=now()) throw Error();
      res.locals.job=job; next();
    } catch { return fail(res,403,'invalid_job_token','This job reference is invalid or expired.'); }
  }
  return {middleware,createGuard,ticket,jobGuard};
}
module.exports={createAccess,validId};
