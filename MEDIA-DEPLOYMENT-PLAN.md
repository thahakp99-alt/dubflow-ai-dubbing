# DubFlow media validation and ffprobe deployment plan — 2026-10-10

## Verified locally

User-reported original: MP4, H.264 High 480x864 30 FPS, AAC-LC stereo
48 kHz, 20.05 seconds, 4,856,380 bytes. User reports full decode without errors.
We did not re-probe the original file in this review.

The reported metadata passes the actual validateMetadata function. A second
loopback test uploads synthetic bytes of exactly the reported size and injects
that metadata into inspection: the route accepts it and sends exactly one request
to an injected mock provider, with ml/en and num_speakers=0. This is not a real dub.
All 91 tests pass. Production validator logic needs no change for this file.

Why accepted: the container list includes mp4/mov, both identified video and audio
streams exist, duration is finite and positive, size is below 100 MiB (104,857,600
bytes). The validator does not reject High profile, these dimensions, 30 FPS,
stereo or 48 kHz. It is a structural probe, not full decoding or provider validation.
Thus media corruption is not established; historical HTTP 400 remains unexplained.

## Safe plan — approval required before remote changes

1. Keep current production service/frontend unchanged. Record current deployed
   commit, runtime, commands and frontend URL. Never export secret values. Existing
   Render auto-deploy was observed previously: do not push to its tracked branch
   as an incidental way of staging code.
2. If the existing service offers Shell, run only read-only availability checks:
   `command -v ffprobe`, `ffprobe -version`, `ffmpeg -version`, `node --version`.
   Do not run env/printenv or echo keys. If Shell is unavailable, check in the
   separately approved staging build/runtime; do not modify production to inspect it.
3. Preferred: retain native Node runtime if ffprobe is actually available. Render
   documents ffmpeg at both build and runtime, but this does not independently
   confirm ffprobe for this service. No install or runtime migration is needed
   when the executable and local fixture probe succeed.
4. After explicit authorization for commit and staging deployment, use a separate
   staging service backed by an isolated branch/revision, with auto-deploy disabled.
   Review any hosting cost before creating it. Set DUBBING_ENABLED=false. Keep real
   ELEVENLABS_API_KEY absent for mock-only checks. Configure a separate private
   DUBFLOW_ACCESS_TOKEN and staging ALLOWED_ORIGINS only after settings authorization.
   Use the existing synthetic fixture, never the private original video in git/image.
5. Proposed native build command: `npm ci --ignore-scripts && npm test`.
   Proposed start command:
   `ffprobe -version >/dev/null && ffmpeg -version >/dev/null && node server.js`
   These are proposed commands, not settings changes performed now. The start guard
   stops startup if executables are missing. npm tests use injected providers only.
   Match a supported Node release to the locally verified release and re-run tests
   on that runtime; do not rely on the open-ended >=20 range for reproducibility.
6. If ffprobe is absent, use a separate Docker staging service. Build from an
   official Node Debian base, install Debian's ffmpeg package (contains ffprobe),
   verify both executables during build, use the lockfile, run as non-root with
   writable /tmp, and exclude .env/secrets/.git/private media from the build context.
   Pin/review the image version or digest at implementation time. No Docker image
   was built or deployed in this review. Avoid unverified downloaded binaries or
   startup-time package installation. Keep the original service intact.
7. Configure staging HTTP health check `/` together with the startup guard. `/`
   alone proves only that Express is running; it does not check media readiness or
   ElevenLabs. Test synthetic ffprobe inspection and the loopback mock upload/job/
   download flow. With DUBBING_ENABLED=false, confirm real POST /api/dub is blocked
   before any provider request. Do not run status/media calls for real provider jobs.
8. Check frontend access-token/CORS compatibility in a staging copy. The existing
   GitHub Pages hostname selection can point to production: explicitly use the
   staging backend in that copy. Do not publish the staging frontend over live Pages.
9. Stop for review. Mock/staging health success does not prove the HTTP 400 fixed.
   Any real ElevenLabs reproduction needs separate permission and a credit budget.
   Only then consider one controlled request with safe diagnostics and no auto-retry.
10. Production cutover requires separate approval after coordinated frontend/backend
    review. Preserve the previous deployment and frontend configuration for rollback.
    Rollback code, frontend and settings together as needed; code rollback alone may
    not restore configuration. Render health checks help prevent routing to a failed
    new instance, but do not guarantee a successful dub or eliminate all downtime risk.

Official references checked:
- https://render.com/docs/native-runtimes
- https://render.com/docs/docker
- https://render.com/docs/health-checks

No commit, deployment, settings changes, real API requests or credits spend occurred.
