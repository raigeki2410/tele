import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const cwd = path.resolve(import.meta.dirname, '..');

const dataDir = path.join(os.tmpdir(), `zalo-tg-spoiler-test-${process.pid}-${Date.now()}`);
process.env.TG_TOKEN ||= 'test-token';
process.env.TG_GROUP_ID ||= '-1001';
process.env.DATA_DIR = dataDir;
delete process.env.TG_MEDIA_SPOILER;

const { isMediaSpoilerEnabled, setMediaSpoilerEnabled } = await import('../src/utils/mediaSpoiler.js');

test('spoiler defaults to off and persists changes', () => {
  assert.equal(isMediaSpoilerEnabled(), false, 'defaults to off when the env flag is unset');

  assert.equal(setMediaSpoilerEnabled(true), true);
  assert.equal(isMediaSpoilerEnabled(), true);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(dataDir, 'media-spoiler.json'), 'utf8')),
    { enabled: true },
  );

  assert.equal(setMediaSpoilerEnabled(false), false);
  assert.equal(isMediaSpoilerEnabled(), false);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(dataDir, 'media-spoiler.json'), 'utf8')),
    { enabled: false },
  );
});

test('TG_MEDIA_SPOILER sets the default and a saved value overrides it', () => {
  const CONFIG_KEYS = [
    'TG_TOKEN', 'TG_GROUP_ID', 'DATA_DIR', 'LOCAL_BOT_API', 'TG_LOCAL_SERVER', 'TG_MEDIA_SPOILER',
  ];
  const run = (overrides: Record<string, string>) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of CONFIG_KEYS) delete env[key];
    Object.assign(env, overrides);
    const script = `
      import('./src/utils/mediaSpoiler.ts')
        .then((m) => console.log(m.isMediaSpoilerEnabled()))
        .catch(err => { console.error(err?.message ?? String(err)); process.exitCode = 1; });
    `;
    return spawnSync(process.execPath, ['--import', 'tsx', '--eval', script], { cwd, env, encoding: 'utf8' });
  };

  const base = { TG_TOKEN: 'token', TG_GROUP_ID: '-1001' };
  const freshDir = path.join(os.tmpdir(), `zalo-tg-spoiler-env-${process.pid}-${Date.now()}`);
  const fromEnv = run({ ...base, DATA_DIR: freshDir, TG_MEDIA_SPOILER: '1' });
  assert.equal(fromEnv.status, 0, fromEnv.stderr);
  assert.equal(fromEnv.stdout.trim(), 'true', 'TG_MEDIA_SPOILER=1 enables the default');

  const savedDir = path.join(os.tmpdir(), `zalo-tg-spoiler-saved-${process.pid}-${Date.now()}`);
  mkdirSync(savedDir, { recursive: true });
  writeFileSync(path.join(savedDir, 'media-spoiler.json'), JSON.stringify({ enabled: false }));
  const fromFile = run({ ...base, DATA_DIR: savedDir, TG_MEDIA_SPOILER: '1' });
  assert.equal(fromFile.status, 0, fromFile.stderr);
  assert.equal(fromFile.stdout.trim(), 'false', 'the /spoiler choice wins over the env default');
});
