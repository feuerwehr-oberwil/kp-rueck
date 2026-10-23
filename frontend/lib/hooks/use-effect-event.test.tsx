import { describe, expect, it } from 'vitest'
import { useEffect } from 'react'
import { render } from '@testing-library/react'
import { useEffectEvent } from '@/lib/hooks/use-effect-event'

/** The stand-in keeps React's contract: a stable function that runs the latest callback. */
describe('useEffectEvent', () => {
  it('runs the latest render’s callback from an effect, and from the cleanup', () => {
    const seen: string[] = []
    function Probe({ label, trigger }: { label: string; trigger: number }) {
      const report = useEffectEvent((when: string) => {
        seen.push(`${when}:${label}`)
      })
      useEffect(() => {
        report('run')
        return () => report('cleanup')
      }, [trigger])
      return null
    }
    const { rerender, unmount } = render(<Probe label="a" trigger={1} />)
    rerender(<Probe label="b" trigger={1} />) // a new label alone re-runs nothing
    rerender(<Probe label="c" trigger={2} />)
    unmount()
    expect(seen).toEqual(['run:a', 'cleanup:c', 'run:c', 'cleanup:c'])
  })

  it('returns the same function on every render', () => {
    const fns: Array<() => void> = []
    function Probe({ n }: { n: number }) {
      const read = useEffectEvent(() => n)
      useEffect(() => {
        fns.push(read)
      })
      return null
    }
    const { rerender } = render(<Probe n={1} />)
    rerender(<Probe n={2} />)
    expect(fns[0]).toBe(fns[1])
  })
})
