/**
 * Component: Audio Content Probe Tests (packet arithmetic, ffprobe mocked)
 * Documentation: documentation/features/chapter-merging.md
 */

import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({ lines: [] as string[], timeBase: '1/48000', sampleRate: '48000' }));
const execFileMock = vi.hoisted(() => {
  const fn = vi.fn();
  (fn as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = async () => ({
    stdout: JSON.stringify({ streams: [{ sample_rate: probe.sampleRate, time_base: probe.timeBase }] }),
    stderr: '',
  });
  return fn;
});
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execFile: execFileMock, spawn: spawnMock }));

import { probeAudioContent } from '@/lib/utils/audio-content';

function packet(pts: number, duration: number, skip?: [number, number]) {
  const side = skip
    ? `,side_datum/skip_samples:side_data_type=Skip Samples,side_datum/skip_samples:skip_samples=${skip[0]},side_datum/skip_samples:discard_padding=${skip[1]}`
    : '';
  return `packet,pts=${pts},duration=${duration}${side}`;
}

/** n AAC frames (1024 samples at 48 kHz) from `from`, back to back. */
function frames(n: number, from = 0): string[] {
  return Array.from({ length: n }, (_, i) => packet(from + i * 1024, 1024));
}

beforeEach(() => {
  probe.lines = [];
  spawnMock.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter & { setEncoding: () => void }; stderr: EventEmitter; kill: () => void };
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    setImmediate(() => {
      child.stdout.emit('data', probe.lines.join('\n') + '\n');
      child.emit('close', 0);
    });
    return child;
  });
});

describe('probeAudioContent', () => {
  it('counts one frame per packet and subtracts priming/padding from Skip Samples', async () => {
    probe.lines = [packet(-1024, 1024, [1024, 0]), ...frames(468), packet(468 * 1024, 256)];
    const content = await probeAudioContent('/x.m4a');
    // 468 full frames + 256 samples
    expect(content.contentMs).toBe(Math.round(((468 * 1024 + 256) / 48000) * 1000));
    expect(content.gapMs).toBe(0);
    expect(content.frameMs).toBe(21.3);
  });

  it('reports a stretched packet over a hole as a gap, not as content, even though the end is full length', async () => {
    // 100 frames, then one packet stretched over 2 s (96000 samples), then 100 frames
    probe.lines = [...frames(100), packet(100 * 1024, 96000), ...frames(100, 100 * 1024 + 96000)];
    const content = await probeAudioContent('/out.m4b');
    expect(content.endMs).toBe(Math.round(((200 * 1024 + 96000) / 48000) * 1000));
    expect(content.contentMs).toBe(Math.round(((201 * 1024) / 48000) * 1000));
    expect(content.gapMs).toBe(Math.round(((96000 - 1024) / 48000) * 1000));
  });

  it('reports a forward timestamp jump as a gap', async () => {
    probe.lines = [...frames(100), ...frames(100, 100 * 1024 + 48000)];
    const content = await probeAudioContent('/out.m4b');
    expect(content.gapMs).toBe(1000);
    expect(content.contentMs).toBe(Math.round(((200 * 1024) / 48000) * 1000));
  });

  it('counts packets with clamped (overlapping) timestamps as full frames', async () => {
    // The muxer clamps overlapping packets to 1 tick; they still hold a frame each
    probe.lines = [...frames(100), ...Array.from({ length: 20 }, (_, i) => packet(100 * 1024 + i, 1)), ...frames(10, 100 * 1024 + 20)];
    const content = await probeAudioContent('/out.m4b');
    expect(content.contentMs).toBe(Math.round(((130 * 1024) / 48000) * 1000));
    expect(content.gapMs).toBe(0);
  });

  it('uses the stream time base (MP3 in 1/14112000) and fails without packets', async () => {
    probe.timeBase = '1/14112000';
    probe.lines = [packet(0, 338688, [1105, 0]), packet(338688, 338688), packet(677376, 338688, [0, 47])];
    const content = await probeAudioContent('/x.mp3');
    expect(content.contentMs).toBe(Math.round(((3 * 1152 - 1105 - 47) / 48000) * 1000));
    probe.timeBase = '1/48000';

    probe.lines = [];
    await expect(probeAudioContent('/empty.mp3')).rejects.toThrow('no audio packets found');
  });
});
