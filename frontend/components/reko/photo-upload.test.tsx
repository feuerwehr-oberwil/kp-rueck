import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, waitFor } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import PhotoUpload from '@/components/reko/photo-upload'

/**
 * The blob URLs behind the instant previews are released when the uploader goes away.
 *
 * The unmount cleanup used to be a mount-only effect closing over the FIRST render's
 * preview map – always empty – so every preview of a session leaked until the page was
 * left (FE-08: a silenced exhaustive-deps).
 */
describe('PhotoUpload previews', () => {
  const realCreate = URL.createObjectURL
  const realRevoke = URL.revokeObjectURL

  beforeEach(() => {
    // jsdom draws nothing: just enough canvas for the JPEG conversion to come through.
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10, height: 10, close() {} })))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage() {},
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['x'])))
    URL.createObjectURL = vi.fn(() => 'blob:preview-1')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    URL.createObjectURL = realCreate
    URL.revokeObjectURL = realRevoke
  })

  it('revokes an uploaded photo’s preview URL on unmount', async () => {
    const onPhotosChange = vi.fn()
    const { container, unmount } = renderWithIntl(
      <PhotoUpload
        photos={[]}
        incidentId="i-1"
        transport={{ upload: async () => 'a.jpg', remove: async () => {} }}
        onPhotosChange={onPhotosChange}
      />,
    )
    const input = container.querySelector('input[type="file"]:not([capture])') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'storm.png', { type: 'image/png' })] } })
    await waitFor(() => expect(onPhotosChange).toHaveBeenCalled())

    unmount()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
  })
})
