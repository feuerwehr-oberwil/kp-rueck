import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const mocks = vi.hoisted(() => ({
  getDeployment: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: { getDeployment: mocks.getDeployment },
}))

import { DeploymentBanner } from '@/components/deployment-banner'
import { resetDeploymentCache } from '@/lib/hooks/use-deployment'

beforeEach(() => {
  resetDeploymentCache()
  mocks.getDeployment.mockReset()
})

describe('DeploymentBanner', () => {
  it('names a staging deployment permanently, with no way to dismiss it', async () => {
    mocks.getDeployment.mockResolvedValue({
      role: 'staging',
      label: 'Staging – Übungssystem',
      blocked_domains: ['alerting', 'sync'],
    })

    renderWithIntl(<DeploymentBanner />)

    const band = await screen.findByRole('note', { name: /Staging – Übungssystem/ })
    expect(band).toHaveTextContent('Staging – Übungssystem')
    // Nothing to click away: a band that can be dismissed is a band somebody dismisses.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders nothing on an ordinary production deployment', async () => {
    mocks.getDeployment.mockResolvedValue({ role: 'production', label: null, blocked_domains: [] })

    const { container } = renderWithIntl(<DeploymentBanner />)

    await waitFor(() => expect(mocks.getDeployment).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('stays silent when the backend cannot be reached', async () => {
    mocks.getDeployment.mockResolvedValue(null)

    const { container } = renderWithIntl(<DeploymentBanner />)

    await waitFor(() => expect(mocks.getDeployment).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
