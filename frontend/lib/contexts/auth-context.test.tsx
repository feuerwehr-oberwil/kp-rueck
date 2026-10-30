import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AuthProvider, useAuth } from "./auth-context"

// --- Mocks ------------------------------------------------------------------

const client = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  localLogin: vi.fn(),
  login: vi.fn(),
  microsoftLogin: vi.fn(),
  logout: vi.fn(),
  refreshToken: vi.fn(),
}))

vi.mock("../auth-client", () => client)
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
vi.mock("../i18n-messages", () => ({ translateOutsideReact: (key: string) => key }))

const EDITOR = { id: "u1", username: "someone", role: "editor" as const }
const STATION = { id: "u2", username: "station-notebook", role: "editor" as const }

const mount = () => renderHook(() => useAuth(), { wrapper: AuthProvider })

beforeEach(() => {
  vi.clearAllMocks()
  client.logout.mockResolvedValue(undefined)
})

// --- The silent local login -------------------------------------------------
//
// On the one machine the stack runs on, opening the board must not show a password prompt;
// everywhere else nothing may change. The mechanism is one attempt per page load — these
// tests are about "once" as much as about "at all".

describe("passwordless local login on mount", () => {
  it("is not attempted when there already is a session", async () => {
    client.getCurrentUser.mockResolvedValue(EDITOR)

    const { result } = mount()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toEqual(EDITOR)
    expect(client.localLogin).not.toHaveBeenCalled()
  })

  it("signs the station machine in before anyone sees a login form", async () => {
    client.getCurrentUser.mockResolvedValue(null)
    client.localLogin.mockResolvedValue(STATION)

    const { result } = mount()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toEqual(STATION)
    expect(result.current.isEditor).toBe(true)
    expect(client.localLogin).toHaveBeenCalledTimes(1)
  })

  it("leaves every other client signed out, with one attempt and no retry", async () => {
    client.getCurrentUser.mockResolvedValue(null)
    // 404 (not configured) and 403 (not this machine) both arrive here as null.
    client.localLogin.mockResolvedValue(null)

    const { result } = mount()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
    expect(client.localLogin).toHaveBeenCalledTimes(1)
  })

  it("treats a failing session probe as signed out and still tries once", async () => {
    client.getCurrentUser.mockRejectedValue(new Error("backend down"))
    client.localLogin.mockResolvedValue(null)

    const { result } = mount()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
  })

  it("does not sign back in when the operator signs out", async () => {
    // The point of tying the attempt to the mount: this provider sits in the root layout and
    // does not re-mount on client navigation, so «Abmelden» → /login stays signed out until
    // somebody reloads the page. Anything else is a logout button that cannot log out.
    client.getCurrentUser.mockResolvedValue(null)
    client.localLogin.mockResolvedValue(STATION)

    const { result } = mount()
    await waitFor(() => expect(result.current.user).toEqual(STATION))

    await act(async () => {
      await result.current.logout()
    })

    expect(result.current.user).toBeNull()
    expect(client.localLogin).toHaveBeenCalledTimes(1)
  })
})
