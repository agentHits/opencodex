export const CONNECT_FRAME_HEADER_BYTES = 5;
export const CONNECT_FLAG_COMPRESSED = 0x01;
export const CONNECT_FLAG_END_STREAM = 0x02;
/** Outbound wire encoding remains uint32-compatible; inbound buffering is intentionally tighter. */
export const MAX_CONNECT_FRAME_PAYLOAD_BYTES = 0xffffffff;
export const MAX_INBOUND_CONNECT_FRAME_PAYLOAD_BYTES = 32 * 1024 * 1024;
export const MAX_INBOUND_CONNECT_FRAME_BYTES =
  CONNECT_FRAME_HEADER_BYTES + MAX_INBOUND_CONNECT_FRAME_PAYLOAD_BYTES;

export type ConnectFrameErrorCode =
  | "invalid_offset"
  | "invalid_flags"
  | "payload_too_large"
  | "frame_incomplete";

export interface ConnectFrame {
  flags: number;
  payload: Uint8Array;
  compressed: boolean;
  endStream: boolean;
}

export interface DecodedConnectFrame {
  frame: ConnectFrame;
  readBytes: number;
}

export interface DecodedConnectFrames {
  frames: ConnectFrame[];
  remainder: Uint8Array;
}

export class ConnectFrameError extends Error {
  constructor(
    public readonly code: ConnectFrameErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectFrameError";
  }
}

export function isConnectFrameCompressed(flags: number): boolean {
  return (flags & CONNECT_FLAG_COMPRESSED) === CONNECT_FLAG_COMPRESSED;
}

export function isConnectFrameEndStream(flags: number): boolean {
  return (flags & CONNECT_FLAG_END_STREAM) === CONNECT_FLAG_END_STREAM;
}

export function encodeConnectFrame(
  payload: Uint8Array,
  options: { flags?: number; compressed?: boolean; endStream?: boolean } = {},
): Uint8Array {
  if (payload.length > MAX_CONNECT_FRAME_PAYLOAD_BYTES) {
    throw new ConnectFrameError("payload_too_large", `Connect frame payload too large: ${payload.length}`);
  }

  let flags = options.flags ?? 0;
  assertByte(flags, "invalid_flags", `Connect frame flags must be a byte: ${flags}`);
  if (options.compressed) flags |= CONNECT_FLAG_COMPRESSED;
  if (options.endStream) flags |= CONNECT_FLAG_END_STREAM;

  const frame = new Uint8Array(CONNECT_FRAME_HEADER_BYTES + payload.length);
  frame[0] = flags;
  new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    .setUint32(1, payload.length, false);
  frame.set(payload, CONNECT_FRAME_HEADER_BYTES);
  return frame;
}

export function tryDecodeConnectFrame(input: Uint8Array, offset = 0): DecodedConnectFrame | null {
  assertOffset(input, offset);
  if (input.length - offset < CONNECT_FRAME_HEADER_BYTES) return null;

  const view = new DataView(input.buffer, input.byteOffset + offset, input.byteLength - offset);
  const flags = view.getUint8(0);
  const length = view.getUint32(1, false);
  if (length > MAX_INBOUND_CONNECT_FRAME_PAYLOAD_BYTES) {
    throw new ConnectFrameError("payload_too_large", `Inbound Connect frame payload too large: ${length}`);
  }
  const readBytes = CONNECT_FRAME_HEADER_BYTES + length;
  if (input.length - offset < readBytes) return null;

  const payloadStart = offset + CONNECT_FRAME_HEADER_BYTES;
  const payloadEnd = payloadStart + length;
  const payload = input.slice(payloadStart, payloadEnd);
  return {
    frame: {
      flags,
      payload,
      compressed: isConnectFrameCompressed(flags),
      endStream: isConnectFrameEndStream(flags),
    },
    readBytes,
  };
}

export function decodeConnectFrame(input: Uint8Array, offset = 0): DecodedConnectFrame {
  const decoded = tryDecodeConnectFrame(input, offset);
  if (!decoded) {
    throw new ConnectFrameError("frame_incomplete", "Incomplete Connect frame");
  }
  return decoded;
}

export function decodeConnectFrames(input: Uint8Array): ConnectFrame[] {
  const frames: ConnectFrame[] = [];
  let offset = 0;
  while (offset < input.length) {
    const decoded = decodeConnectFrame(input, offset);
    frames.push(decoded.frame);
    offset += decoded.readBytes;
  }
  return frames;
}

export function decodeAvailableConnectFrames(input: Uint8Array): DecodedConnectFrames {
  const frames: ConnectFrame[] = [];
  let offset = 0;
  while (offset < input.length) {
    const decoded = tryDecodeConnectFrame(input, offset);
    if (!decoded) break;
    frames.push(decoded.frame);
    offset += decoded.readBytes;
  }
  return {
    frames,
    remainder: offset === input.length ? new Uint8Array() : input.slice(offset),
  };
}

/**
 * Incrementally decode a transport chunk without concatenating bytes beyond one bounded frame.
 * `pending` must be the incomplete remainder returned by an earlier call.
 */
export function decodeConnectStreamChunk(
  pending: Uint8Array,
  chunk: Uint8Array,
): DecodedConnectFrames {
  if (pending.length === 0) return decodeAvailableConnectFrames(chunk);
  if (pending.length > MAX_INBOUND_CONNECT_FRAME_BYTES) {
    throw new ConnectFrameError("payload_too_large", "Inbound Connect pending frame exceeded its byte limit");
  }

  let carry = pending;
  let rest = chunk;
  if (carry.length < CONNECT_FRAME_HEADER_BYTES) {
    const headerBytes = Math.min(CONNECT_FRAME_HEADER_BYTES - carry.length, rest.length);
    carry = concatBytes(carry, rest.subarray(0, headerBytes));
    rest = rest.subarray(headerBytes);
    if (carry.length < CONNECT_FRAME_HEADER_BYTES) return { frames: [], remainder: carry };
  }

  // The header-only decode validates the declared length before any payload accumulation.
  const view = new DataView(carry.buffer, carry.byteOffset, carry.byteLength);
  const payloadBytes = view.getUint32(1, false);
  if (payloadBytes > MAX_INBOUND_CONNECT_FRAME_PAYLOAD_BYTES) {
    throw new ConnectFrameError("payload_too_large", `Inbound Connect frame payload too large: ${payloadBytes}`);
  }
  const frameBytes = CONNECT_FRAME_HEADER_BYTES + payloadBytes;
  const needed = frameBytes - carry.length;
  if (needed < 0) {
    throw new ConnectFrameError("frame_incomplete", "Invalid Connect pending-frame boundary");
  }
  if (rest.length < needed) {
    const remainder = concatBytes(carry, rest);
    if (remainder.length > MAX_INBOUND_CONNECT_FRAME_BYTES) {
      throw new ConnectFrameError("payload_too_large", "Inbound Connect pending frame exceeded its byte limit");
    }
    return { frames: [], remainder };
  }

  const completed = concatBytes(carry, rest.subarray(0, needed));
  const first = decodeConnectFrame(completed).frame;
  const following = decodeAvailableConnectFrames(rest.subarray(needed));
  return { frames: [first, ...following.frames], remainder: following.remainder };
}

function assertOffset(input: Uint8Array, offset: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > input.length) {
    throw new ConnectFrameError("invalid_offset", `Invalid Connect frame offset: ${offset}`);
  }
}

function assertByte(value: number, code: ConnectFrameErrorCode, message: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new ConnectFrameError(code, message);
  }
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
