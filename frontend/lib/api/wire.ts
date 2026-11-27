// The server's own types, read off its contract. `docs/openapi.json` is generated from the
// backend's pydantic models (`just openapi`, kept fresh by a pytest), and `./schema.d.ts` is
// generated from that (`pnpm openapi:types`, kept fresh by ./schema.test). A wire type in
// lib/api/types is an alias of one of these, so a field renamed or retyped on the server is a
// tsc error here instead of an `undefined` at runtime. Where the client deliberately differs,
// the alias says so with an intersection or `Omit`, next to the reason. Same file as KP Front's
// `src/lib/api/wire.ts`.
import type { components } from './schema'

type Schemas = components['schemas']

/** A value as the server sends it. pydantic serialises every field, defaults included, so a
 *  field the schema marks optional (it has a default) is always present – deep. */
export type Served<T> = T extends readonly (infer U)[] ? Served<U>[]
  : T extends object ? { [K in keyof T]-?: Served<T[K]> }
  : T

/** A response model, as served. */
export type Out<N extends keyof Schemas> = Served<Schemas[N]>

/** A response the route serves with `response_model_exclude_unset` (a stored document): a
 *  field the schema marks optional may be absent, exactly as the schema says. */
export type Sparse<N extends keyof Schemas> = Schemas[N]

/** A request model, as the client may write it (a defaulted field may be left out). */
export type In<N extends keyof Schemas> = Schemas[N]

/** A PATCH body whose fields `K` the spec marks nullable only because pydantic's «not sent»
 *  default is None: the column is NOT NULL, so the client sends a value or leaves it out. */
export type SentOrOmitted<T, K extends keyof T> = Omit<T, K> & { [P in K]?: Exclude<T[P], null> }
