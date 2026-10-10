# DubFlow — local phase 2

## സുരക്ഷിത local demo

```sh
npm ci --ignore-scripts
npm test
npm run mock
```

`http://127.0.0.1:10000` തുറക്കുക. ഈ demo loopback-ൽ മാത്രം listen ചെയ്യുന്നു. Demo access token സ്വയം നിറയും. Output ഒരു 2-second synthetic test MP4 ആണ്; യഥാർത്ഥ dubbing അല്ല. Mock client-ന് ElevenLabs network call ഇല്ല; യഥാർത്ഥ API key വേണ്ട.

`test/fixtures/mock-video.mp4`: locally generated H.264/AAC, 320×180, 2 seconds; no user video/audio.

## Production configuration — ഇപ്പോൾ deploy ചെയ്യരുത്

`.env.example`-ൽ environment variable പേരുകൾ മാത്രം നൽകിയിട്ടുണ്ട്. ഈ app `.env` സ്വയം വായിക്കുന്നില്ല: hosting environment variables ഉപയോഗിക്കണം (അല്ലെങ്കിൽ Node-യുടെ explicit --env-file flag).

- `ELEVENLABS_API_KEY`: server-ൽ മാത്രം.
- `DUBFLOW_ACCESS_TOKEN`: വേറൊരു random 32+ character owner token. Frontend password field-ൽ ഈ token മാത്രം നൽകണം. Token browser storage, URLs, source code, logs എന്നിവയിൽ സൂക്ഷിക്കുന്നില്ല; input memory-ൽ മാത്രമാണ്.
- `ALLOWED_ORIGINS`: comma-separated exact origins. GitHub Pages origin `https://thahakp99-alt.github.io` ആണ്; repository path ചേർക്കരുത്.
- `DUBBING_ENABLED`: default false. Real/paid test-ന് അനുമതി ലഭിച്ച ശേഷം മാത്രമേ true ആക്കാവൂ.
- `DUBBING_WATERMARK`: legacy v1 request-ൽ explicit watermark; default `false` (legacy API default). HTTP 400 പരിഹാരമായി ഇതിനെ കാണരുത്. Watermark ഉപയോഗിച്ചാലും generation credits ചെലവാകും. ഈ local മാറ്റം Render settings മാറ്റുന്നില്ല.
- `PORT`: Render നൽകുന്ന port സ്വീകരിക്കും; default 10000.

Access token private single-owner usage-നാണ്. Multi-user sign-in/roles ഇല്ല. Token മറ്റൊരാൾക്ക് നൽകിയാൽ അവർക്കും owner API access ലഭിക്കും.

API routes:

| Route | ആവശ്യമായ headers | പ്രവർത്തനം |
|---|---|---|
| POST /api/dub | Authorization: Bearer … | video + source_lang + target_lang; creation switch enabled ആയിരിക്കണം |
| GET /api/jobs/:id | Authorization + X-Job-Token | status |
| GET /api/jobs/:id/media | Authorization + X-Job-Token | ready status ഉറപ്പാക്കി media proxy stream |

Create response-ലെ signed `job_token` job ID, target language, expiry എന്നിവ ബന്ധിപ്പിക്കുന്നു. Expiry 7 days. Job reference sessionStorage-ൽ സൂക്ഷിക്കുന്നതിനാൽ അതേ tab refresh ചെയ്താൽ Resume ചെയ്യാം; owner token വീണ്ടും നൽകണം. അതേ server secret ഉണ്ടെങ്കിൽ restart-നുശേഷവും signed reference പ്രവർത്തിക്കും. Secret rotate ചെയ്താൽ പഴയ reference അസാധുവാകും.

## Limits

- Upload 100 MiB; download 200 MiB.
- Single create/upload in flight per process.
- Authenticated API requests: 120/minute per process; creates: 6/hour per process.
- Auth failures: coarse shared 60/minute limiter; individual clients/IP map ഇല്ല.
- Counters memory-യിലാണ്; restart reset ചെയ്യും, replicas തമ്മിൽ share ചെയ്യില്ല. Multi-instance/public service-ക്ക് durable shared rate limiter, per-user auth, usage budgets വേണം.
- Poll every 5 seconds, maximum 120 checks; പിന്നീട് manual Resume. Stop polling server job cancel ചെയ്യില്ല. Create auto-retry ഇല്ല.
- Preview/download blob browser memory ഉപയോഗിക്കും; low-memory phones-ൽ ചെറിയ videos ഉപയോഗിക്കുക.
- Provider MP4/WebM നൽകിയാൽ video; MP3 നൽകിയാൽ audio ആയി label/filename. API key URL-ലോ browser-ലോ എത്തില്ല.
- Browser codec support അനുസരിച്ച് preview മാറാം; download വഴി മറ്റൊരു player ഉപയോഗിക്കാം.

## Validation boundaries

89 automated local/mock tests passed in the latest review. Dependency audit reported 0 known vulnerabilities at the time of the check; this is not a guarantee of no security issues. Frontend script tested with a DOM stub; actual browser/device rendering and ElevenLabs video translation quality were not tested. The original 20-second media and historical provider response body remain unavailable.

No GitHub commit/push, Render deploy, live changes or paid API tests were performed.

## Historical notes — superseded by 2026-10-10 review

താഴെയുള്ള watermark hypothesis പുതിയ Support മറുപടിയോടെ പിൻവലിച്ചു.

## HTTP 400 അന്വേഷണം — 2026-10-09

GitHub main `142839642790c4780af0777558e7c6f78f7ab9ca`-യിലെ server.js മുമ്പ് പരിശോധിച്ച original code-നോട് byte-for-byte ഒത്തുപോയി. User ElevenLabs Request Log-ൽ മൂന്ന് POST /v1/dubbing requests HTTP 400 ആയതായി സ്ഥിരീകരിച്ചു; അവയുടെ response body ലഭിച്ചിട്ടില്ല. Render dashboard ഈ പരിശോധനയിലും login പേജിലാണ്. User നൽകിയ Render logs startup/deploy success മാത്രമാണ് കാണിക്കുന്നത്.

Original multipart fields: file, target_lang (en fallback), source_lang (എപ്പോഴും auto), num_speakers (0). watermark അയയ്ക്കുന്നില്ല. Legacy API default watermark=false. Free-plan watermark നിയന്ത്രണം ഒരു സാധ്യതയാണ്; യഥാർത്ഥ account plan/permissions/error body കാണാതെ root cause സ്ഥിരീകരിച്ചിട്ടില്ല. HTTP 400 മാത്രം invalid key, quota, permission, media/language പ്രശ്നങ്ങൾ വേർതിരിക്കാൻ മതിയല്ല.

Local patch explicit server-controlled watermark ചേർത്തു; തെറ്റായ configuration provider call-ന് മുമ്പ് നിരസിക്കും. മുൻ local fixes source_lang selection, safe error codes, upstream HTTP status/reference logging എന്നിവ നിലനിർത്തുന്നു. Raw provider message/headers/keys log ചെയ്യുന്നില്ല. Automatic retry ഇല്ല. v2 API-ലേക്ക് migrate ചെയ്തിട്ടില്ല. .env.example ഒരു template മാത്രമാണ്; യഥാർത്ഥ environment മാറ്റിയിട്ടില്ല.

75 local/mock tests passed, 0 failed. പുതിയ checks: HTTP 400 subscription/quota/permission errors safely surfaced; hypothetical watermark plan rule rejects false/accepts true without retries; invalid watermark setting makes zero provider calls. Mock rule യഥാർത്ഥ ElevenLabs account behavior-ന്റെ തെളിവല്ല. യഥാർത്ഥ API request ഒന്നും നടത്തിയിട്ടില്ല.

Remaining evidence: പഴയ failed request-ന്റെ response error code/message (രഹസ്യവിവരങ്ങളില്ലാതെ), ബന്ധപ്പെട്ട key-യുടെ Dubbing scope, key quota/account balance, account plan/status. പുതിയ dubbing request ആവശ്യമില്ല. Login ലഭിച്ചാൽ പഴയ records read-only ആയി പരിശോധിക്കണം. ഈ patch deploy-ready approval അല്ല; മുമ്പത്തെ frontend/backend compatibility review-ലെ deployment blockers തുടരും.

Sources:
- https://elevenlabs.io/docs/api-reference/legacy/dubbing/create
- https://elevenlabs.io/docs/help-center/product/dubbing/on-which-plans-can-i-use-dubbing
- https://elevenlabs.io/docs/api-reference/authentication


## 2026-10-10 — Support-informed parameter and diagnostics review

User-reported Support response: omitted watermark is not the Free-plan rejection cause;
credits/permission are considered unlikely (not ruled out); historical response bodies
cannot be recovered. We do not claim the historical root cause is known.

GitHub main server.js and index.html were fetched read-only and matched the inspected
original git HEAD. Local source-language fix remains: send the actual UI selection,
not hardcoded auto. Current UI languages ml/en/hi/ta/ar are explicitly allowed;
auto is source-only. Missing fields retain auto/en defaults; empty/duplicate/unknown
values fail before the provider call. These are application restrictions, not the
complete ElevenLabs language list. Legacy field names source_lang/target_lang are
correct; do not substitute v2 source_language/target_language.

num_speakers=0 is documented speaker auto-detection, serialized as a multipart string.
Native FormData owns the boundary; xi-api-key is server-only. mode=automatic and
dubbing_studio=false remain omitted defaults. watermark stays configurable but defaults
to false in local code/template; the hypothetical watermark-plan rejection test was
replaced by neutral serialization coverage. No real environment was changed.

Media inspection now uses ffprobe BEFORE any creation call. It checks recognized
container, identified audio AND video streams, and positive duration. Octet-stream
MIME is allowed through to inspection (some devices send this for real videos).
This is a structural probe, not full decoding, speech detection or a guarantee of
provider codec acceptance. No automatic transcoding is performed. The original
20-second file is unavailable; its codec is UNKNOWN. Only our synthetic 2-second
fixture is verified H.264/AAC in MP4.

DEPLOYMENT PREREQUISITE: ffprobe must be installed in the backend runtime. It is
available locally; Render availability is NOT verified. Missing executable returns
503 before any provider call. Probe timeout is 15 seconds, output cap 256 KiB,
no shell, protocol allowlist file/pipe. There is no deployment authorization.

Provider failure logs now include the local requestId, HTTP status, a bounded
projection of the provider error body (symbolic status/code, known validation
field/type, classified media/language category), and validated request-id,
x-request-id, trace-id or x-trace-id response headers WHEN PRESENT. A provider
reference is not invented if missing. Known server secrets are excluded. No raw
message, input, ctx, headers, file metadata/tags, filename, exception or HTML body
is logged. Arbitrary free text is intentionally omitted, so this diagnostic record
is NOT a full recoverable raw response body. Client still gets safe error text and
local request_id; server-side references correlate via this local ID. Create,
status and media HTTP failure paths use the same diagnostic projection. No retry.

Validation: 89 tests pass, 0 failures. Real upstream fetch disabled in test processes;
only loopback HTTP and injected provider mocks. Includes actual local ffprobe of
synthetic MP4, unreadable video rejected before upstream, missing inspector fail-closed,
missing streams, malformed/duplicate languages, MIME fallback, 400 reference correlation,
422 projection, secret omission, and complete mock upload/status/preview-download flow.
No new ElevenLabs API calls, credits spend, commit, deployment, or live changes.

Next: obtain the original failed video for LOCAL ffprobe/decoding inspection if available.
Any staging deployment or real reproduction requires separate explicit permission;
mock success does not establish actual dubbing success.

Additional official references:
- https://elevenlabs.io/docs/overview/capabilities/dubbing
- https://elevenlabs.io/docs/help-center/product/dubbing/which-file-formats-are-supported-by-dubbing


## 2026-10-10 original media metadata follow-up

User reports original MP4 H.264 High/AAC-LC, 480x864, 30 FPS, stereo 48 kHz, 20.05 seconds, 4,856,380 bytes, full decode without errors. These values pass local validation; no production validator change required. Two additional tests verify metadata acceptance and an upload of matching synthetic byte size through the mock route. Latest total: 91 passed, 0 failed. This review uses user-reported metadata, not a new decode of the original bytes. See MEDIA-DEPLOYMENT-PLAN.md for the native-first ffprobe verification and isolated staging/rollback plan. All earlier test counts are historical.
