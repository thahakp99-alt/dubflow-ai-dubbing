# Disabled staging — prepared locally, NOT deployed

Current-service check (2026-10-10): Render service URL redirected to Sign In.
Consequently ffprobe/ffmpeg availability in the existing service remains UNVERIFIED.
No shell commands ran on Render. Do not confuse successful LOCAL preflight with
Render verification. Once authenticated, read-only checks are `command -v ffprobe`,
`ffprobe -version`, `command -v ffmpeg`, `ffmpeg -version`; never print environment.

## Files
- server.js: staging-only entry point. Requires DUBBING_ENABLED exactly false,
  no ELEVENLABS_API_KEY value, a separate private 32+ character DUBFLOW_ACCESS_TOKEN.
  Runs ffprobe/ffmpeg and probes the synthetic test fixture before listening.
  Hardcodes disabled creation and an empty provider key; outbound provider fetch
  is a throwing stub as additional protection. No production server changes.
- render.staging.yaml: preferred native Node proposal, pinned Node 24.19.0.
- render.staging-docker.yaml: optional alternative, not a second service to apply.
- Dockerfile and Dockerfile.dockerignore: explicit-copy non-root fallback with Debian
  ffmpeg. Docker is unavailable locally, so image build and tag resolution are NOT
  verified. Do not select fallback before verifying its build.
- TEST_RESULTS.txt: three targeted staging tests passed. Earlier 91 tests were not
  repeated in this turn; these tests cover the new staging wrapper only.

## Configuration
DUBBING_ENABLED=false; DUBFLOW_ACCESS_TOKEN generated privately on the new service.
ELEVENLABS_API_KEY must remain absent; no production environment groups.
RENDER_EXTERNAL_URL and PORT supplied by Render. Local-only STAGING_ORIGIN can
substitute for RENDER_EXTERNAL_URL. Same-origin frontend served by staging process:
never points to live backend. Token is not embedded in HTML or browser storage.
Health path /healthz is available only after startup preflight in normal entry point.
This stage checks startup, UI/auth and disabled-job behavior; it cannot dub or test
provider-backed status/download. Complete simulated job flow remains local via
npm run mock. Do NOT deploy mock-server.js or expose its built-in demo token.

## Exact next authorized actions (none performed)
1. Obtain explicit permission to commit/push the prepared files ONLY to a NEW
   `dubflow-staging-disabled` branch. Before pushing, inspect current GitHub Actions,
   Pages source and Render branch triggers to ensure this branch cannot deploy live.
   Do not push main, merge, or create/modify production deployment settings.
2. Separately authorize creating ONE new Free staging service and its listed
   environment configuration, using staging/render.staging.yaml as Blueprint path.
   The branch is proposed and does not exist yet. Confirm Free is actually available
   in the account; if not, stop for budget approval. No paid substitute.
   autoDeployTrigger is off (initial creation still deploys).
3. Never attach the existing production service to this Blueprint. Verify proposed
   name does not collide with an existing service. Stop if it would update one.
4. Native startup fails closed if media tools absent. Only then consider the Docker
   fallback after successful isolated build verification and specific approval.
5. Verify staging health/startup, blocked POST /api/dub, frontend same-origin and
   token protection. No real provider key, generation, or historical job calls.
6. Stop for review. No production cutover or real API test is authorized by staging
   approval. Rollback this stage by stopping the NEW service; production stays intact.

References: https://render.com/docs/blueprint-spec ; https://render.com/docs/native-runtimes
