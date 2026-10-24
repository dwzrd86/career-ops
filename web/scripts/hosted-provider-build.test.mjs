import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// Build with this fictional server credential, then pass the disposable outDir
// via HOSTED_PROVIDER_BUILD_DIR. Never requires or reads real provider secrets.
const marker = 'fictional-hosted-provider-build-key';
test('compiled frontend excludes the hosted credential and server transport', async () => {
  const dir = process.env.HOSTED_PROVIDER_BUILD_DIR;
  assert.ok(dir, 'Set HOSTED_PROVIDER_BUILD_DIR to a fresh disposable build');
  const files = await readdir(dir, { recursive: true });
  const scripts = files.filter(name => /\.(?:html|js|css|map)$/.test(name));
  assert.ok(scripts.some(name => name.endsWith('.js')), 'Expected compiled application scripts');
  for (const file of scripts) {
    const content = await readFile(path.join(dir, file), 'utf8');
    for (const excluded of [marker, 'HOSTED_AI_ZAI_API_KEY', 'HOSTED_AI_ZAI_BOUND_EVIDENCE',
      'https://api.z.ai/api/paas/v4/chat/completions']) {
      assert.equal(content.includes(excluded), false, `Server-only material in ${file}`);
    }
  }
});
