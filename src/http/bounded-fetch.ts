import { TransportError } from "../errors.js";

export async function readBoundedBody(response: Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new TransportError("HTTP request timed out"));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new TransportError(`Response exceeded configured limit of ${maxBytes} bytes`);
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** A single exchange, including streamed body consumption; never retries OAuth. */
export async function boundedFetch(url: string, init: RequestInit, timeoutMs: number, maxBytes: number): Promise<{ response: Response; body: string }> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new TransportError("HTTP request timed out"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([(async () => {
      const response = await fetch(url, { ...init, signal: controller.signal });
      return { response, body: await readBoundedBody(response, maxBytes, controller.signal) };
    })(), expired]);
  } finally {
    clearTimeout(timeout);
  }
}
