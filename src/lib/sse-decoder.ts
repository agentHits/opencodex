export interface ServerSentEvent {
  event?: string;
  data: string;
}

export const MAX_SSE_RECORD_BYTES = 4 * 1024 * 1024;

export class SseRecordTooLargeError extends Error {
  readonly code = "sse_record_too_large";
  constructor(limit: number) {
    super(`upstream SSE record exceeded the ${limit}-byte limit`);
    this.name = "SseRecordTooLargeError";
  }
}

export type SseRecord =
  | { kind: "event"; event?: string; data: string }
  | { kind: "comment"; comment: string };

/**
 * Decode text/event-stream records across arbitrary fetch chunk boundaries.
 *
 * The final record is dispatched at EOF even when the upstream omits the trailing blank line or
 * final newline. That matters for compatible APIs that place a terminal event in the last bytes of
 * the body: dropping that record turns a successful response into an adapter_eof failure.
 */
export function decodeServerSentEvents(
  source: ReadableStream<Uint8Array>,
  options: { includeComments: true; signal?: AbortSignal; maxRecordBytes?: number },
): AsyncGenerator<SseRecord>;
export function decodeServerSentEvents(
  source: ReadableStream<Uint8Array>,
  options?: { includeComments?: false; signal?: AbortSignal; maxRecordBytes?: number },
): AsyncGenerator<ServerSentEvent>;
export async function* decodeServerSentEvents(
  source: ReadableStream<Uint8Array>,
  options?: { includeComments?: boolean; signal?: AbortSignal; maxRecordBytes?: number },
): AsyncGenerator<ServerSentEvent | SseRecord> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | undefined;
  let dataLines: string[] = [];
  let recordBytes = 0;
  const maxRecordBytes = options?.maxRecordBytes ?? MAX_SSE_RECORD_BYTES;
  // Prompt cancellation channel: an abort cancels the underlying reader directly, which
  // settles any in-flight read() so a consumer's iterator.return() cannot hang behind an
  // idle upstream (a plain generator return waits for the pending await first).
  const signal = options?.signal;
  const onAbort = () => { reader.cancel(signal?.reason).catch(() => { /* already closed */ }); };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  const includeComments = options?.includeComments === true;

  const dispatch = (): ServerSentEvent | SseRecord | undefined => {
    if (dataLines.length === 0) {
      event = undefined;
      return undefined;
    }
    const record = { ...(event ? { event } : {}), data: dataLines.join("\n") };
    event = undefined;
    dataLines = [];
    recordBytes = 0;
    return includeComments ? { kind: "event", ...record } : record;
  };

  const acceptLine = (rawLine: string): ServerSentEvent | SseRecord | undefined => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") return dispatch();
    if (line.startsWith(":")) {
      if (!includeComments) return undefined;
      let comment = line.slice(1);
      if (comment.startsWith(" ")) comment = comment.slice(1);
      return { kind: "comment", comment };
    }

    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") event = value;
    else if (field === "data") {
      const added = Buffer.byteLength(value, "utf8") + (dataLines.length > 0 ? 1 : 0);
      if (recordBytes + added > maxRecordBytes) throw new SseRecordTooLargeError(maxRecordBytes);
      recordBytes += added;
      dataLines.push(value);
    }
    return undefined;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });

      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        if (Buffer.byteLength(line, "utf8") > maxRecordBytes) throw new SseRecordTooLargeError(maxRecordBytes);
        const record = acceptLine(line);
        buffer = buffer.slice(newline + 1);
        if (record) yield record;
      }

      if (Buffer.byteLength(buffer, "utf8") > maxRecordBytes) {
        throw new SseRecordTooLargeError(maxRecordBytes);
      }

      if (!done) continue;
      buffer += decoder.decode();
      if (buffer.length > 0) {
        if (Buffer.byteLength(buffer, "utf8") > maxRecordBytes) throw new SseRecordTooLargeError(maxRecordBytes);
        const record = acceptLine(buffer);
        buffer = "";
        if (record) yield record;
      }
      const finalRecord = dispatch();
      if (finalRecord) yield finalRecord;
      break;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try { await reader.cancel(); } catch { /* already closed/errored */ }
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
