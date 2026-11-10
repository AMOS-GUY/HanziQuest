/** Bounded JSON body reading for route handlers. */
export class PayloadTooLargeError extends Error {}

/** Reads a JSON body, refusing anything larger than `maxBytes` (even without Content-Length). */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new PayloadTooLargeError();
  if (!request.body) throw new SyntaxError("empty body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
