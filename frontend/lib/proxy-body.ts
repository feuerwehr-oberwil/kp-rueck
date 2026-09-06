// The largest default upload is a 25 MiB workbook; leave room for multipart fields.
export const MAX_PROXY_BODY_BYTES = 32 * 1024 * 1024
const MAX_BUFFERED_BODY_BYTES = 64 * 1024 * 1024
export const PROXY_TIMEOUT_MS = 120_000

let bufferedBytes = 0

export class ProxyRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

/** Read a replayable body without letting concurrent uploads exhaust the process. */
export async function readProxyBody(request: Request, signal: AbortSignal) {
  const length = request.headers.get('content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_PROXY_BODY_BYTES)) {
    throw new ProxyRequestError(413, 'Request body too large')
  }

  let reserved = 0
  const release = () => {
    bufferedBytes -= reserved
    reserved = 0
  }
  if (!request.body) return { body: undefined, release }

  const reader = request.body.getReader()
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    const chunks: Uint8Array<ArrayBuffer>[] = []
    while (true) {
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      if (reserved + value.byteLength > MAX_PROXY_BODY_BYTES) {
        throw new ProxyRequestError(413, 'Request body too large')
      }
      if (bufferedBytes + value.byteLength > MAX_BUFFERED_BODY_BYTES) {
        throw new ProxyRequestError(503, 'Upload capacity busy; retry shortly')
      }
      reserved += value.byteLength
      bufferedBytes += value.byteLength
      // Own each chunk: the request producer may reuse its input buffer.
      chunks.push(new Uint8Array(value))
    }
    // Blob is replayable for FastAPI's trailing-slash redirects. Its immutable
    // copy costs at most one extra body budget, rather than unbounded uploads.
    const body = new Blob(chunks)
    return { body, release }
  } catch (error) {
    release()
    void reader.cancel(error).catch(() => {})
    throw error
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}
