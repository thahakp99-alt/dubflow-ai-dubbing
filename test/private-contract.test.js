const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const { createApp } = require('../server');
const { inspectVideo } = require('../media-validation');

// No provider transport: only explicit loopback requests use native fetch.
const loopbackFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('External fetch disabled'); };
const VIDEO = process.env.DUBFLOW_TEST_VIDEO || path.join(__dirname, 'fixtures/mock-video.mp4');
const PLACEHOLDER = 'MOCK_ONLY_NOT_A_REAL_API_KEY';
const ACCESS = 'MOCK_ONLY_ACCESS_TOKEN_32_CHARACTERS';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Defaults must be tested independently of the caller's configuration/secrets.
delete process.env.ELEVENLABS_API_KEY;
delete process.env.DUBBING_WATERMARK;

test('contract: selected video passes real media validation', async () => {
  const bytes = await fs.readFile(VIDEO);
  assert.ok(bytes.length > 0);
  const media = await inspectVideo(VIDEO);
  assert.ok(media.duration > 0);
});

for (const scenario of ['success', 'validation400', 'body-timeout', 'body-error', 'headers-timeout']) {
  test(`contract: multipart bytes and safe logging / ${scenario}`, async t => {
    const bytes = await fs.readFile(VIDEO);
    const logs = [];
    let calls = 0;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dubflow-contract-upload-'));
    const app = createApp({
      apiKey: PLACEHOLDER, accessToken: ACCESS, dubbingEnabled: true, uploadDir: dir,
      logger: { warn: entry => logs.push(entry) },
      fetchImpl: async (url, options) => {
        calls++;
        assert.equal(url, 'https://api.elevenlabs.io/v1/dubbing');
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers['xi-api-key'], PLACEHOLDER);
        assert.equal(options.signal.aborted, false);
        // Request serializes multipart locally; this object is NEVER sent.
        const wire = new Request(url, options);
        assert.match(wire.headers.get('content-type'), /^multipart\/form-data; boundary=/);
        const form = await wire.formData();
        const expected = { source_lang: 'ml', target_lang: 'en', num_speakers: '0',
          watermark: 'true', dubbing_studio: 'false' };
        assert.deepEqual([...form.keys()].sort(), ['file', ...Object.keys(expected)].sort());
        for (const [name, value] of Object.entries(expected)) assert.equal(form.get(name), value);
        const file = form.get('file');
        assert.equal(file.type, 'video/mp4');
        assert.equal(file.name, 'diagnostic.mp4');
        assert.equal(file.size, bytes.length);
        assert.equal(digest(Buffer.from(await file.arrayBuffer())), digest(bytes));
        if (scenario === 'headers-timeout') {
          throw Object.assign(new Error('RAW_PRIVATE_ERROR'), { name: 'TimeoutError' });
        }
        const headers = new Headers({ 'request-id': 'mock-request-123456', 'x-trace-id': 'mock-trace-123456' });
        if (scenario.startsWith('body-')) return {
          status: 400, headers,
          text: async () => { throw Object.assign(new Error('RAW_PRIVATE_ERROR'), {
            name: scenario === 'body-timeout' ? 'TimeoutError' : 'Error',
          }); },
        };
        const data = scenario === 'success' ? { dubbing_id: 'mock-job' } : {
          detail: [{ type: 'bool_parsing', loc: ['body', 'dubbing_studio'],
            msg: 'RAW_PRIVATE_ERROR', input: PLACEHOLDER, ctx: { secret: ACCESS } }],
        };
        return new Response(JSON.stringify(data), { status: scenario === 'success' ? 200 : 400, headers });
      },
    });
    const server = app.listen(0, '127.0.0.1');
    t.after(async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await fs.rm(dir, { recursive: true, force: true });
    });
    await once(server, 'listening');
    const form = new FormData();
    form.append('video', new Blob([bytes], { type: 'video/mp4' }), 'diagnostic.mp4');
    form.append('source_lang', 'ml');
    form.append('target_lang', 'en');
    const response = await loopbackFetch(`http://127.0.0.1:${server.address().port}/api/dub`, {
      method: 'POST', headers: { Authorization: `Bearer ${ACCESS}` }, body: form,
    });
    const data = await response.json();
    assert.equal(calls, 1, 'No automatic retry');
    assert.equal(response.status, { success: 200, validation400: 400,
      'body-timeout': 504, 'body-error': 502, 'headers-timeout': 504 }[scenario]);
    if (scenario === 'success') {
      assert.equal(data.dubbing_id, 'mock-job');
      assert.equal(logs.length, 0);
    } else {
      assert.equal(logs.length, 1);
      const log = logs[0];
      assert.equal(log.requestId, data.request_id);
      assert.ok(data.request_id);
      if (scenario === 'headers-timeout') {
        assert.equal(data.upstream_status, undefined);
        assert.equal(log.upstreamStatus, undefined);
        assert.equal(log.providerReferences, undefined);
      } else {
        assert.equal(data.upstream_status, 400);
        assert.equal(log.upstreamStatus, 400);
        assert.equal(log.providerReferences['request-id'], 'mock-request-123456');
        assert.equal(log.providerReferences['x-trace-id'], 'mock-trace-123456');
        if (scenario.startsWith('body-')) assert.equal(log.providerBodyRead, 'failed');
        else {
          assert.equal(log.providerErrorBody.errors[0].type, 'bool_parsing');
          assert.deepEqual(log.providerErrorBody.errors[0].fields, ['body', 'dubbing_studio']);
        }
      }
    }
    const output = JSON.stringify({ logs, data });
    for (const forbidden of [PLACEHOLDER, ACCESS, 'RAW_PRIVATE_ERROR', 'diagnostic.mp4']) {
      assert.ok(!output.includes(forbidden), 'Private data must not reach output');
    }
  });
}
