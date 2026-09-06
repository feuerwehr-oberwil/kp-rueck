// @vitest-environment node
import { expect, it } from 'vitest'
import { MAX_PROXY_BODY_BYTES, readProxyBody } from './proxy-body'

it('bounds aggregate buffered bytes and releases capacity after failure and completion', async () => {
  const request = (size: number) => new Request('https://station.example/', {
    method: 'POST', body: new Uint8Array(size),
  })
  const signal = new AbortController().signal
  const first = await readProxyBody(request(MAX_PROXY_BODY_BYTES), signal)
  const second = await readProxyBody(request(MAX_PROXY_BODY_BYTES), signal)
  try {
    await expect(readProxyBody(request(1), signal)).rejects.toMatchObject({ status: 503 })
    first.release()
    first.release() // cleanup is safe even when cancellation also releases the request
    const next = await readProxyBody(request(MAX_PROXY_BODY_BYTES), signal)
    next.release()
  } finally {
    first.release()
    second.release()
  }
  const after = await readProxyBody(request(MAX_PROXY_BODY_BYTES), signal)
  after.release()
})
