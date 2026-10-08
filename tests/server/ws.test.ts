import { describe, expect, it } from 'vitest';
import { decodeFrames, encodeFrame, maskFrame, OP } from '../../server/ws.ts';

describe('websocket framing', () => {
  it('round-trips short, medium and long text frames', () => {
    for (const len of [5, 300, 70_000 - 10]) {
      const text = 'x'.repeat(Math.min(len, 60_000));
      const { frames, rest } = decodeFrames(encodeFrame(OP.text, Buffer.from(text)));
      expect(rest.length).toBe(0);
      expect(frames[0].payload.toString()).toBe(text);
      expect(frames[0].fin).toBe(true);
    }
  });

  it('unmasks client frames and keeps partial frames for later', () => {
    const framed = maskFrame(OP.text, Buffer.from('{"type":"ping"}'));
    const first = decodeFrames(framed.subarray(0, 5));
    expect(first.frames).toHaveLength(0);
    const all = decodeFrames(Buffer.concat([first.rest, framed.subarray(5)]));
    expect(all.frames[0].payload.toString()).toBe('{"type":"ping"}');
  });

  it('reads several frames in one chunk and refuses giant ones', () => {
    const two = Buffer.concat([maskFrame(OP.text, Buffer.from('a')), maskFrame(OP.ping, Buffer.alloc(0))]);
    expect(decodeFrames(two).frames.map((f) => f.opcode)).toEqual([OP.text, OP.ping]);
    const huge = Buffer.from([0x81, 127, 0, 0, 0, 0, 1, 0, 0, 0]);
    expect(decodeFrames(huge).error).toBe('frame too large');
  });
});
