// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript'

// schema.d.ts is generated from docs/openapi.json, which a pytest keeps equal to the backend.
// This keeps the second link: a contract change without `just openapi` (or `pnpm openapi:types`)
// fails here, not as a wire type that silently describes last week's server. The options are
// the `openapi:types` script's (package.json).
describe('lib/api/schema.d.ts', () => {
  it('is what docs/openapi.json generates', async () => {
    const spec = new URL(`file://${resolve(__dirname, '../../../docs/openapi.json')}`)
    const want = `${COMMENT_HEADER}${astToString(await openapiTS(spec, { defaultNonNullable: false }))}`
    const have = readFileSync(resolve(__dirname, 'schema.d.ts'), 'utf8')
    expect(have === want, 'run `just openapi` (or `pnpm openapi:types` in frontend/)').toBe(true)
  })
})
