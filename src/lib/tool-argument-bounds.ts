export interface ToolArgumentLimits {
  perCallBytes: number;
  perTurnBytes: number;
}

const DEFAULT_TOOL_ARGUMENT_LIMITS: ToolArgumentLimits = {
  perCallBytes: 8 * 1024 * 1024,
  perTurnBytes: 32 * 1024 * 1024,
};

let limits = { ...DEFAULT_TOOL_ARGUMENT_LIMITS };

export function currentToolArgumentLimits(): ToolArgumentLimits {
  return limits;
}

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function appendToolArguments(
  current: string,
  currentBytes: number,
  retainedTurnBytes: number,
  fragment: string,
): { value: string; valueBytes: number; retainedTurnBytes: number } | null {
  const fragmentBytes = utf8ByteLength(fragment);
  if (
    currentBytes + fragmentBytes > limits.perCallBytes
    || retainedTurnBytes + fragmentBytes > limits.perTurnBytes
  ) return null;
  return {
    value: current + fragment,
    valueBytes: currentBytes + fragmentBytes,
    retainedTurnBytes: retainedTurnBytes + fragmentBytes,
  };
}

export function replaceToolArguments(
  currentBytes: number,
  retainedTurnBytes: number,
  replacement: string,
): { valueBytes: number; retainedTurnBytes: number } | null {
  const valueBytes = utf8ByteLength(replacement);
  const nextTurnBytes = retainedTurnBytes - currentBytes + valueBytes;
  if (valueBytes > limits.perCallBytes || nextTurnBytes > limits.perTurnBytes) return null;
  return { valueBytes, retainedTurnBytes: Math.max(0, nextTurnBytes) };
}

/** Test seam: lower bounds without allocating production-sized fixtures. */
export function setToolArgumentLimitsForTests(overrides: Partial<ToolArgumentLimits> | null): void {
  limits = overrides
    ? { ...DEFAULT_TOOL_ARGUMENT_LIMITS, ...overrides }
    : { ...DEFAULT_TOOL_ARGUMENT_LIMITS };
}
