import { describe, expect, it } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

import { renderWithIntl } from '@/test-utils/render-with-intl'
import { PhotoViewerProvider } from '@/components/photos/photo-viewer'
import { usePhotoViewer, useRegisterPhotos } from '@/lib/hooks/use-photo-viewer'
import type { ViewerPhoto } from '@/lib/photo-lightbox'

const reko: ViewerPhoto[] = ['a.jpg', 'b.jpg'].map(filename => ({
  group: 'reko', filename, src: `/api/photos/i/${filename}`, by: 'Suter Beat', at: null,
}))
const rapport: ViewerPhoto[] = [{ group: 'rapport', filename: 'r.jpg', src: '/api/photos/i/r.jpg', by: null, at: null }]

function Thumbs() {
  useRegisterPhotos('rapport', rapport)
  const open = usePhotoViewer()
  return <button type="button" onClick={() => open?.('rapport', 'r.jpg')}>open rapport</button>
}

describe('PhotoViewerProvider', () => {
  it('opens on the tapped photo, pages through Reko into Rapport with the keys, and Esc closes', () => {
    renderWithIntl(
      <PhotoViewerProvider incidentLabel="10 · Rebbergstrasse 5" fallback={{ reko }}>
        <Thumbs />
      </PhotoViewerProvider>,
    )
    fireEvent.click(screen.getByText('open rapport'))
    const viewer = screen.getByTestId('photo-viewer')
    expect(viewer).toHaveTextContent('3 / 3')
    expect(viewer).toHaveTextContent('10 · Rebbergstrasse 5')
    expect(viewer).toHaveTextContent('Rapport')

    fireEvent.keyDown(viewer, { key: 'ArrowLeft' })
    expect(viewer).toHaveTextContent('2 / 3')
    expect(viewer).toHaveTextContent('Suter Beat')
    fireEvent.keyDown(viewer, { key: 'Home' })
    expect(viewer).toHaveTextContent('1 / 3')
    fireEvent.keyDown(viewer, { key: 'ArrowLeft' })
    expect(viewer).toHaveTextContent('1 / 3')

    fireEvent.keyDown(viewer, { key: 'Escape' })
    expect(screen.queryByTestId('photo-viewer')).not.toBeInTheDocument()
  })
})
