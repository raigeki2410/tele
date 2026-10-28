/**
 * Node >= 26 compatibility fix for Telegram file uploads.
 *
 * Telegraf builds multipart bodies with `sandwich-stream`'s SandwichStream, whose
 * `bindCurrentStreamEvents()` waits on the legacy `'readable'` event. On Node 26
 * that event no longer drives data out of the sub-streams, so the multipart body
 * never produces a single byte: every media upload to api.telegram.org hangs for
 * ~60 s and then fails with "socket hang up".
 *
 * Measured on the same machine and payload:
 *   curl 0.85 s · native fetch 0.71 s · Telegraf 60.6 s (hang)
 * so only this stream plumbing is broken — the network is fine.
 *
 * Patching the prototype (instead of forking the dependency) leaves the rest of
 * the library untouched and also applies to Telegraf's MultipartStream subclass.
 * MUST be imported before any upload happens — see index.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let SandwichStream: any;
try {
  // Transitive dependency of telegraf; guarded so an install layout that does
  // not hoist it cannot crash the bridge at boot.
  ({ SandwichStream } = require('sandwich-stream'));
} catch {
  SandwichStream = undefined;
}

if (SandwichStream?.prototype) {
  // Drain sub-streams in flowing mode instead of relying on 'readable'.
  SandwichStream.prototype.bindCurrentStreamEvents = function (this: any): void {
    this.currentStream.on('data', (chunk: unknown) => this.push(chunk));
    this.currentStream.on('end', this.currentStreamOnEnd.bind(this));
  };
}
