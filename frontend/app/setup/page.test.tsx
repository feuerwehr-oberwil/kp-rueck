import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const getSetupStatus = vi.hoisted(() => vi.fn())
const claimSetup = vi.hoisted(() => vi.fn())
const mockLogin = vi.fn()
const mockPush = vi.fn()
const mockReplace = vi.fn()

// Stable like the real Next router — a fresh object per render would re-run
// the page's `[router]` mount effect on every keystroke.
const mockRouter = { push: mockPush, replace: mockReplace }
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}))
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ login: mockLogin }),
}))
// The page needs the real ApiError for its instanceof checks (409 vs. the rest);
// only the client instance itself is replaced.
vi.mock('@/lib/api-client', async () => {
  const { ApiError } = await vi.importActual<typeof import('@/lib/api/types')>('@/lib/api/types')
  return { ApiError, apiClient: { getSetupStatus, claimSetup } }
})

import { ApiError } from '@/lib/api-client'
import SetupPage from './page'

const VALID_PASSWORD = 'korrekt-pferd-batterie'

/** jsdom cannot navigate; the hard post-claim navigation lands here instead. */
const assign = vi.fn()

/** Renders the page and waits out the claimed-check that gates the form. */
async function renderForm() {
  renderWithIntl(<SetupPage />)
  await screen.findByLabelText('Name der Feuerwehr')
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  {
    name = 'Feuerwehr Testwil',
    password = VALID_PASSWORD,
    repeat = password,
  }: { name?: string; password?: string; repeat?: string } = {}
) {
  await user.type(screen.getByLabelText('Name der Feuerwehr'), name)
  await user.type(screen.getByLabelText(/mindestens 12 Zeichen/), password)
  await user.type(screen.getByLabelText('Admin-Passwort wiederholen'), repeat)
  await user.click(screen.getByRole('button', { name: 'Board einrichten' }))
}

describe('SetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSetupStatus.mockResolvedValue({ claimed: false })
    claimSetup.mockResolvedValue({ username: 'admin' })
    mockLogin.mockResolvedValue({ role: 'admin' })
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    })
  })

  it('renders the claim form once the board turns out to be unclaimed', async () => {
    await renderForm()

    expect(screen.getByText('Dieses Board einrichten')).toBeInTheDocument()
    expect(screen.getByLabelText(/mindestens 12 Zeichen/)).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Board einrichten' })).toBeInTheDocument()
    // The quiet footer: everything else waits in Settings / docs/SETUP.md.
    expect(screen.getByText('docs/SETUP.md')).toBeInTheDocument()
  })

  it('redirects a claimed board straight to / on mount', async () => {
    getSetupStatus.mockResolvedValue({ claimed: true })
    renderWithIntl(<SetupPage />)

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'))
    expect(screen.queryByLabelText('Name der Feuerwehr')).not.toBeInTheDocument()
  })

  it('refuses a short password without asking the server', async () => {
    const user = userEvent.setup()
    await renderForm()

    // 11 characters — one short of the minimum.
    await fillAndSubmit(user, { password: 'elf-zeichen', repeat: 'elf-zeichen' })

    expect(screen.getByText('Das Passwort muss mindestens 12 Zeichen lang sein.')).toBeInTheDocument()
    expect(claimSetup).not.toHaveBeenCalled()
  })

  it('refuses mismatching passwords without asking the server', async () => {
    const user = userEvent.setup()
    await renderForm()

    await fillAndSubmit(user, { repeat: VALID_PASSWORD + '-anders' })

    expect(screen.getByText('Die Passwörter stimmen nicht überein.')).toBeInTheDocument()
    expect(claimSetup).not.toHaveBeenCalled()
  })

  it('claims the board, signs in as admin and hard-navigates home', async () => {
    const user = userEvent.setup()
    await renderForm()

    await fillAndSubmit(user)

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
    expect(claimSetup).toHaveBeenCalledWith({
      station_name: 'Feuerwehr Testwil',
      admin_password: VALID_PASSWORD,
    })
    // The claim's response names the account; the password is the one just chosen.
    expect(mockLogin).toHaveBeenCalledWith('admin', VALID_PASSWORD)
  })

  it('shows the already-claimed state with a way to the login on 409', async () => {
    const user = userEvent.setup()
    claimSetup.mockRejectedValue(new ApiError('Board bereits eingerichtet', 409, true))
    await renderForm()

    await fillAndSubmit(user)

    expect(await screen.findByText('Bereits eingerichtet')).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Zur Anmeldung' }))
    expect(mockPush).toHaveBeenCalledWith('/login')
  })

  it('relays the backend refusal honestly on 422', async () => {
    const user = userEvent.setup()
    claimSetup.mockRejectedValue(new ApiError('Passwort erfüllt die Anforderungen nicht', 422))
    await renderForm()

    await fillAndSubmit(user)

    expect(await screen.findByText('Passwort erfüllt die Anforderungen nicht')).toBeInTheDocument()
    // The form stays usable — no dead end after a refused claim.
    expect(screen.getByRole('button', { name: 'Board einrichten' })).toBeEnabled()
    expect(assign).not.toHaveBeenCalled()
  })
})
