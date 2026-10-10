const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { createAccess, validId } = require("./access");

const { inspectVideo } = require("./media-validation");
const { diagnostics } = require("./provider-diagnostics");
const LANGUAGES = new Set(["ml", "en", "hi", "ta", "ar"]); // Languages offered by this UI.

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const PROVIDER_ERRORS = {
  invalid_api_key: "ElevenLabs API key is invalid. Check the server configuration.",
  quota_exceeded: "ElevenLabs credits or quota are insufficient. Check the account.",
  insufficient_credits: "ElevenLabs credits are insufficient. Check the account.",
  missing_permissions: "The ElevenLabs API key does not have the required permission.",
  permission_denied: "ElevenLabs denied permission for this request.",
  subscription_required: "This operation requires an eligible ElevenLabs subscription.",
  too_many_concurrent_requests: "ElevenLabs is handling too many requests. Try later.",
  rate_limit_exceeded: "ElevenLabs rate limit reached. Try later.",
  invalid_language: "ElevenLabs rejected the selected language.",
  unsupported_language: "ElevenLabs does not support the requested language for this operation.",
};

// Never forward raw provider messages, request headers, files, or exception objects.
function providerError(data, status) {
  const detail = data && data.detail;
  const code = detail && typeof detail === "object" && !Array.isArray(detail)
    ? detail.status || detail.code : undefined;
  if (typeof code === "string" && Object.hasOwn(PROVIDER_ERRORS, code)) {
    return { code, error: PROVIDER_ERRORS[code] };
  }
  const fallback = {
    400: ["provider_bad_request", "ElevenLabs rejected the request. Check the video and languages."],
    401: ["provider_unauthorized", "ElevenLabs authentication failed. Check the server API key."],
    402: ["provider_payment_required", "ElevenLabs requires an account billing or credit check."],
    403: ["provider_forbidden", "ElevenLabs denied this operation. Check API permissions and account access."],
    413: ["provider_file_too_large", "ElevenLabs rejected the file size."],
    422: ["provider_validation_error", "ElevenLabs could not validate the video or request fields."],
    429: ["provider_rate_limited", "ElevenLabs request limit reached. Try later."],
  };
  const [safeCode, error] = fallback[status] ||
    ["provider_error", "ElevenLabs rejected the dubbing request. Check the server log reference."];
  return { code: safeCode, error };
}

function createApp({
  fetchImpl = globalThis.fetch,
  inspectVideoImpl = inspectVideo,
  apiKey = process.env.ELEVENLABS_API_KEY,
  logger = console,
  uploadDir = "/tmp/",
  maxFileSize = MAX_VIDEO_BYTES,
  timeoutMs = 120000,
  accessToken = process.env.DUBFLOW_ACCESS_TOKEN,
  allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://thahakp99-alt.github.io").split(",").map(x=>x.trim()).filter(Boolean),
  dubbingEnabled = process.env.DUBBING_ENABLED === "true",
  // Legacy API defaults to no watermark. Make the choice explicit; never retry
  // a rejected create automatically. This does not make generation credit-free.
  dubbingWatermark = process.env.DUBBING_WATERMARK ?? "false",
  maxDownloadBytes = 200 * 1024 * 1024,
  createLimit = 6,
  readLimit = 120,
  now = Date.now,
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req,res,next)=>{res.set("X-Content-Type-Options","nosniff");next();});
  app.use(cors({origin(origin,cb){cb(null,!origin || allowedOrigins.includes(origin));},
    methods:["GET","POST","OPTIONS"],allowedHeaders:["Authorization","Content-Type","X-Job-Token"],
    exposedHeaders:["Content-Disposition","Retry-After"]}));
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    next();
  });

  function fail(res, status, code, error, upstreamStatus, providerDetails) {
    const requestId = res.locals.requestId;
    logger.warn({ event: "dub_request_failed", requestId, code,
      ...(upstreamStatus ? { upstreamStatus } : {}),
      ...(providerDetails || {}) });
    return res.status(status).json({ error, code, request_id: requestId,
      ...(upstreamStatus ? { upstream_status: upstreamStatus } : {}) });
  }

  const access = createAccess({token:accessToken,origins:allowedOrigins,fail,now,createLimit,readLimit});
  app.use("/api",access.middleware);
  let activeCreate = false;
  function createGuard(req,res,next) {
    if(!dubbingEnabled) return fail(res,503,"dubbing_disabled","New dubbing jobs are disabled on this server.");
    if(activeCreate) return fail(res,429,"upload_busy","Another upload is in progress. Try later.");
    activeCreate=true;
    const release=()=>{activeCreate=false;};
    res.locals.releaseCreate=release;
    const releaseBeforeHandler=()=>{if(!res.locals.processingCreate)release();};
    res.once("finish",releaseBeforeHandler); res.once("close",releaseBeforeHandler);
    next();
  }
  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: maxFileSize, files: 1, fields: 2, fieldSize: 64, parts: 3, fieldNameSize: 32 },
    fileFilter(req, file, cb) {
      if (!file.mimetype.startsWith("video/") && file.mimetype !== "application/octet-stream") {
        const error = new Error("Video required");
        error.code = "INVALID_VIDEO_TYPE";
        return cb(error);
      }
      cb(null, true);
    },
  });

  app.get("/", (req, res) => res.json({ message: "DubFlow backend is running" }));

  app.post("/api/dub", access.createGuard, createGuard, upload.single("video"), async (req, res) => {
    if (!req.file) return fail(res, 400, "video_required", "Video required");
    res.locals.processingCreate=true;
    try {
      const source = req.body.source_lang ?? "auto";
      const target = req.body.target_lang ?? "en";
      const validLanguage = value => typeof value === "string" && LANGUAGES.has(value);
      if ((source !== "auto" && !validLanguage(source)) || !validLanguage(target)) {
        return fail(res, 400, "invalid_language", "Choose a valid source and target language.");
      }
      if (!apiKey || !apiKey.trim()) {
        return fail(res, 503, "api_key_not_configured", "API key not configured on the server.");
      }
      if (!["true", "false"].includes(dubbingWatermark)) {
        return fail(res, 503, "invalid_watermark_configuration", "DUBBING_WATERMARK must be true or false on the server.");
      }
      try { await inspectVideoImpl(req.file.path); }
      catch (error) {
        const unavailable = error.code === "media_inspector_unavailable";
        return fail(res, unavailable ? 503 : 400,
          unavailable ? "media_inspector_unavailable" : "invalid_video_media",
          unavailable ? "Server media inspection is unavailable. Install ffprobe before enabling dubbing."
            : "Upload a readable video containing an audio track and a positive duration.");
      }
      const buffer = await fs.readFile(req.file.path);
      const form = new FormData();
      form.append("file", new Blob([buffer], { type: req.file.mimetype }), req.file.originalname);
      form.append("target_lang", target);
      form.append("source_lang", source);
      form.append("num_speakers", "0");
      form.append("watermark", dubbingWatermark);

      let response;
      let raw;
      try {
        response = await fetchImpl("https://api.elevenlabs.io/v1/dubbing", {
          method: "POST",
          headers: { "xi-api-key": apiKey.trim() },
          body: form,
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
        raw = await response.text();
      } catch (error) {
        const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
        return fail(res, timedOut ? 504 : 502,
          timedOut ? "provider_timeout" : "provider_connection_error",
          "Could not confirm whether ElevenLabs accepted the request. Check its history before retrying; a job may already exist.");
      }

      let data;
      try { data = JSON.parse(raw); } catch { /* Never expose raw content. */ }
      if (!response.ok) {
        const safe = providerError(data, response.status);
        return fail(res, response.status >= 400 && response.status <= 599 ? response.status : 502,
          safe.code, safe.error, response.status, diagnostics(data,response.headers,[apiKey,accessToken]));
      }
      if (!data || !validId(data.dubbing_id)) {
        return fail(res, 502, "invalid_provider_response",
          "ElevenLabs returned an unexpected response. Check its history before retrying; a job may already exist.");
      }
      return res.json({ dubbing_id: data.dubbing_id, job_token: access.ticket(data.dubbing_id,target), target_lang:target,
        ...(Number.isFinite(data.expected_duration_sec)
          ? { expected_duration_sec: data.expected_duration_sec } : {}) });
    } catch {
      return fail(res, 500, "internal_error", "The server could not process this video.");
    } finally {
      try { await fs.unlink(req.file.path); }
      catch (error) {
        if (error.code !== "ENOENT") logger.warn({
          event: "upload_cleanup_failed", requestId: res.locals.requestId,
        });
      }
      res.locals.releaseCreate();
    }
  });

  async function providerJSON(path) {
    if(!apiKey || !apiKey.trim()) throw {status:503,code:"api_key_not_configured",error:"API key not configured on the server."};
    const response=await fetchImpl("https://api.elevenlabs.io/v1/dubbing/"+path,{
      headers:{"xi-api-key":apiKey.trim()},signal:AbortSignal.timeout(timeoutMs),redirect:"error"});
    let data;try{data=await response.json();}catch{}
    if(!response.ok) throw {status:response.status,...providerError(data,response.status),providerDetails:diagnostics(data,response.headers,[apiKey,accessToken])};
    if(!data || !["queued","preparing","dubbing","dubbed","failed"].includes(data.status))
      throw {status:502,code:"invalid_provider_response",error:"Unexpected job status from ElevenLabs."};
    return data;
  }
  function jobError(res,error) {
    if(res.headersSent) {res.destroy();return;}
    const known=Number.isInteger(error.status) && error.status>=400 && error.status<=599;
    return fail(res,known?error.status:502,known?error.code:"provider_connection_error",
      known?error.error:"Could not retrieve this job. Try checking its status later.",
      known && error.providerDetails ? error.status : undefined, error.providerDetails);
  }
  app.get("/api/jobs/:id",access.jobGuard,async(req,res)=>{
    try {
      const data=await providerJSON(req.params.id);
      res.json({dubbing_id:req.params.id,status:data.status,target_lang:res.locals.job.target,
        ...(data.status==="failed"?{error:"Dubbing failed. Check the ElevenLabs project for details."}:{})});
    }catch(error){jobError(res,error);}
  });
  app.get("/api/jobs/:id/media",access.jobGuard,async(req,res)=>{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),timeoutMs);
    const disconnect=()=>{if(!res.writableFinished)controller.abort();};
    res.once("close",disconnect);
    try {
      const data=await providerJSON(req.params.id);
      if(data.status!=="dubbed") return fail(res,409,"job_not_ready","The dubbed file is not ready.");
      const response=await fetchImpl(`https://api.elevenlabs.io/v1/dubbing/${req.params.id}/audio/${res.locals.job.target}`,{
        headers:{"xi-api-key":apiKey.trim()},signal:controller.signal,redirect:"error"});
      const discard=async()=>{if(response.body)await response.body.cancel();};
      if(!response.ok) {
        let errorData; try { errorData=await response.json(); } catch {}
        return fail(res,502,"media_unavailable","The dubbed file is unavailable. Try later.",
          response.status,diagnostics(errorData,response.headers,[apiKey,accessToken]));
      }
      const type=(response.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
      const extensions={"video/mp4":"mp4","video/webm":"webm","audio/mpeg":"mp3"};
      if(!extensions[type] || !response.body) {await discard();return fail(res,502,"invalid_media","The provider did not return supported media.");}
      const length=Number(response.headers.get("content-length"));
      if(length>maxDownloadBytes) {await discard();return fail(res,413,"media_too_large","Dubbed media exceeds the download limit.");}
      res.type(type);
      res.set("Content-Disposition",`attachment; filename="dubflow-${res.locals.job.target}.${extensions[type]}"`);
      let received=0;
      const limit=new Transform({transform(chunk,encoding,callback){
        received+=chunk.length;
        callback(received>maxDownloadBytes?new Error("media_limit"):null,chunk);
      }});
      await pipeline(Readable.fromWeb(response.body),limit,res,{signal:controller.signal});
    }catch(error){jobError(res,error);}
    finally{clearTimeout(timeout);res.off("close",disconnect);}
  });

  // Multer errors happen before the route handler; return JSON instead of HTML.
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.code === "LIMIT_FILE_SIZE") {
      return fail(res, 413, "video_too_large", "Video exceeds the upload size limit (100 MB in production).");
    }
    if (error instanceof multer.MulterError || error.code === "INVALID_VIDEO_TYPE") {
      return fail(res, 400, "invalid_upload", "Upload one video with source_lang and target_lang fields.");
    }
    return fail(res, 400, "invalid_request", "The upload request could not be read.");
  });
  return app;
}

if (require.main === module) {
  const PORT = process.env.PORT || 10000;
  createApp().listen(PORT, "0.0.0.0", () => console.log(`DubFlow running on port ${PORT}`));
}
module.exports = { createApp, MAX_VIDEO_BYTES };
