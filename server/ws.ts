import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

/**
 * A small RFC 6455 WebSocket server: the handshake, text frames (fragmented or not),
 * ping/pong and close. Enough for pushing Valley updates to browsers without pulling
 * in a dependency; the hub above it only ever sends JSON text.
 */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 64 * 1024;
const HEARTBEAT_MS = 25_000;

export const OP = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa } as const;

export interface Frame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
}

/** Encodes one server frame (servers never mask). */
export function encodeFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = (fin ? 0x80 : 0) | opcode;
  if (len < 126) head[1] = len;
  else if (len < 65536) {
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

/** Masks a payload the way a client must (for tests and tools). */
export function maskFrame(opcode: number, payload: Buffer, mask = Buffer.from([1, 2, 3, 4])): Buffer {
  const frame = encodeFrame(opcode, Buffer.alloc(0));
  const len = payload.length;
  const head = len < 126 ? Buffer.from([frame[0], 0x80 | len]) : Buffer.concat([Buffer.from([frame[0], 0x80 | 126]), Buffer.from([len >> 8, len & 0xff])]);
  const body = Buffer.alloc(len);
  for (let i = 0; i < len; i++) body[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([head, mask, body]);
}

/** Splits as many complete frames as `buf` holds; returns them and the leftover bytes. */
export function decodeFrames(buf: Buffer): { frames: Frame[]; rest: Buffer; error?: string } {
  const frames: Frame[] = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off];
    const b1 = buf[off + 1];
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      const big = buf.readBigUInt64BE(p);
      if (big > BigInt(MAX_MESSAGE)) return { frames, rest: Buffer.alloc(0), error: 'frame too large' };
      len = Number(big);
      p += 8;
    }
    if (len > MAX_MESSAGE) return { frames, rest: Buffer.alloc(0), error: 'frame too large' };
    const maskLen = masked ? 4 : 0;
    if (buf.length - p < maskLen + len) break;
    const mask = masked ? buf.subarray(p, p + 4) : null;
    p += maskLen;
    const payload = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let i = 0; i < len; i++) payload[i] ^= mask[i % 4];
    frames.push({ fin: (b0 & 0x80) !== 0, opcode: b0 & 0x0f, payload });
    off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}

export class WsConnection {
  onMessage: ((text: string) => void) | null = null;
  onClose: (() => void) | null = null;
  private buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private closed = false;
  private alive = true;
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(private readonly socket: Duplex) {
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
    this.heartbeat = setInterval(() => {
      if (!this.alive) {
        this.close();
        return;
      }
      this.alive = false;
      this.write(encodeFrame(OP.ping, Buffer.alloc(0)));
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  send(text: string): void {
    this.write(encodeFrame(OP.text, Buffer.from(text, 'utf8')));
  }

  close(code = 1000): void {
    if (this.closed) return;
    const body = Buffer.alloc(2);
    body.writeUInt16BE(code, 0);
    this.write(encodeFrame(OP.close, body));
    this.socket.end();
    this.finish();
  }

  private write(buf: Buffer): void {
    if (!this.closed && this.socket.writable) this.socket.write(buf);
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    this.socket.destroy();
    this.onClose?.();
  }

  private receive(chunk: Buffer): void {
    this.alive = true;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const { frames, rest, error } = decodeFrames(this.buffer);
    this.buffer = Buffer.from(rest);
    if (error) {
      this.close(1009);
      return;
    }
    for (const f of frames) {
      switch (f.opcode) {
        case OP.text:
        case OP.continuation:
          this.fragments.push(f.payload);
          if (this.fragments.reduce((n, b) => n + b.length, 0) > MAX_MESSAGE) {
            this.close(1009);
            return;
          }
          if (f.fin) {
            const text = Buffer.concat(this.fragments).toString('utf8');
            this.fragments = [];
            this.onMessage?.(text);
          }
          break;
        case OP.ping:
          this.write(encodeFrame(OP.pong, f.payload));
          break;
        case OP.close:
          this.close();
          return;
        default:
          break;
      }
    }
  }
}

/** Completes the handshake. Returns null (and closes the socket) for anything that isn't a WebSocket upgrade. */
export function acceptWebSocket(req: IncomingMessage, socket: Duplex): WsConnection | null {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || typeof key !== 'string') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
  return new WsConnection(socket);
}
