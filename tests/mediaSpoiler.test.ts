import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const cwd = path.resolve(import.meta.dirname, '..');

const CONFIG_KEYS = [
  'TG_TOKEN', 'TG_GROUP_ID', 'DATA_DIR', 'LOCAL_BOT_API', 'TG_LOCAL_SERVER', 'TG_MEDIA_SPOILER',
] as const;

const BASE_ENV = { TG_TOKEN: 'token', TG_GROUP_ID: '-1001' };
const NONEXISTENT_ENV = path.join(os.tmpdir(), `zalo-tg-nonexistent-${process.pid}.env`);

function runMediaSpoiler(overrides: Record<string, string>, dataDir: string) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of CONFIG_KEYS) delete env[key];
  env.DOTENV_CONFIG_PATH = NONEXISTENT_ENV;
  Object.assign(env, BASE_ENV, overrides, { DATA_DIR: dataDir });
  const script = `
    import('./src/utils/mediaSpoiler.ts')
      .then((m) => console.log(m.isMediaSpoilerEnabled()))
      .catch(err => { console.error(err?.message ?? String(err)); process.exitCode = 1; });
  `;
  return spawnSync(process.execPath, ['--import', 'tsx', '--eval', script], { cwd, env, encoding: 'utf8' });
}

function runMediaSpoilerSet(dataDir: string, value: boolean) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of CONFIG_KEYS) delete env[key];
  env.DOTENV_CONFIG_PATH = NONEXISTENT_ENV;
  Object.assign(env, BASE_ENV, { DATA_DIR: dataDir });
  const script = `
    import('./src/utils/mediaSpoiler.ts')
      .then((m) => console.log(m.setMediaSpoilerEnabled(${value})))
      .catch(err => { console.error(err?.message ?? String(err)); process.exitCode = 1; });
  `;
  return spawnSync(process.execPath, ['--import', 'tsx', '--eval', script], { cwd, env, encoding: 'utf8' });
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

test('spoiler defaults to off and persists changes', () => {
  const dataDir = path.join(os.tmpdir(), `zalo-tg-spoiler-test-${process.pid}-${Date.now()}`);
  mkdirSync(dataDir, { recursive: true });
  try {
    // Default should be false (TG_MEDIA_SPOILER not set)
    const def = runMediaSpoiler({}, dataDir);
    assert.equal(def.status, 0, def.stderr);
    assert.equal(stripAnsi(def.stdout.trim()), 'false', 'defaults to off when the env flag is unset');

    // Set to true
    const setTrue = runMediaSpoilerSet(dataDir, true);
    assert.equal(setTrue.status, 0, setTrue.stderr);
    assert.equal(stripAnsi(setTrue.stdout.trim()), 'true');

    // Verify persisted
    const getTrue = runMediaSpoiler({}, dataDir);
    assert.equal(getTrue.status, 0, getTrue.stderr);
    assert.equal(stripAnsi(getTrue.stdout.trim()), 'true');

    // Verify file content
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(dataDir, 'media-spoiler.json'), 'utf8')),
      { enabled: true },
    );

    // Set to false
    const setFalse = runMediaSpoilerSet(dataDir, false);
    assert.equal(setFalse.status, 0, setFalse.stderr);
    assert.equal(stripAnsi(setFalse.stdout.trim()), 'false');

    // Verify persisted
    const getFalse = runMediaSpoiler({}, dataDir);
    assert.equal(getFalse.status, 0, getFalse.stderr);
    assert.equal(stripAnsi(getFalse.stdout.trim()), 'false');

    assert.deepEqual(
      JSON.parse(readFileSync(path.join(dataDir, 'media-spoiler.json'), 'utf8')),
      { enabled: false },
    );
  } finally {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
});

test('TG_MEDIA_SPOILER sets the default and a saved value overrides it', () => {
  const freshDir = path.join(os.tmpdir(), `zalo-tg-spoiler-env-${process.pid}-${Date.now()}`);
  mkdirSync(freshDir, { recursive: true });
  try {
    const fromEnv = runMediaSpoiler({ TG_MEDIA_SPOILER: '1' }, freshDir);
    assert.equal(fromEnv.status, 0, fromEnv.stderr);
    assert.equal(stripAnsi(fromEnv.stdout.trim()), 'true', 'TG_MEDIA_SPOILER=1 enables the default');
  } finally {
    try { rmSync(freshDir, { recursive: true, force: true }); } catch {}
  }

  const savedDir = path.join(os.tmpdir(), `zalo-tg-spoiler-saved-${process.pid}-${Date.now()}`);
  mkdirSync(savedDir, { recursive: true });
  try {
    writeFileSync(path.join(savedDir, 'media-spoiler.json'), JSON.stringify({ enabled: false }));
    const fromFile = runMediaSpoiler({ TG_MEDIA_SPOILER: '1' }, savedDir);
    assert.equal(fromFile.status, 0, fromFile.stderr);
    assert.equal(stripAnsi(fromFile.stdout.trim()), 'false', 'the /spoiler choice wins over the env default');
  } finally {
    try { rmSync(savedDir, { recursive: true, force: true }); } catch {}
  }
});
