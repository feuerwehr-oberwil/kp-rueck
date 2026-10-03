import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import de from '@/messages/de.json'

// --- every literal key the code asks for exists ------------------------------------
//
// The catalogue tests (i18n-messages.test.ts, i18n.test.ts) compare the catalogues with
// EACH OTHER: fr covers de, placeholders match, nothing is blank. None of them looks at
// the code, so a key renamed in de.json AND fr.json together passes all of them while
// every call site still asking for the old name renders the raw key. That is exactly
// what put «events.page.incidentCount» on the /display event list: the key became
// `incidentCountShort` for /events in August, /display kept asking for the old one, and
// next-intl does not throw — it prints the path.
//
// This test closes the gap from the code side. It parses every component and module,
// finds each translator — `const t = useTranslations('ns')` / `await getTranslations(…)`
// — resolves every `t('literal')`, `t.rich('literal')`, `t.raw(…)`, `t.markup(…)` call
// to the translator it actually refers to (by symbol, so a `t` shadowed in a nested
// component binds to the right namespace) and checks `ns.literal` against de.json.
// `translateOutsideReact('full.key')` is checked too. German is the source every other
// catalogue is merged over, so a key present in de.json resolves in every locale; that
// fr carries it as well is the catalogue tests' job.
//
// Template literals with a `${…}` are skipped on purpose: their keys only exist at
// runtime, and the status/type-keyed blocks they reach are pinned by the label
// coverage tests instead. A translator handed in as a prop is skipped for the same
// reason — its namespace is the caller's.

const ROOT = resolve(__dirname, '..')
const SOURCE_DIRS = ['app', 'components', 'lib']

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(path)
    }
  }
  return out
}

type Kind = 'string' | 'raw'
interface Usage { file: string; line: number; key: string; kind: Kind }

/** The namespace a translator factory call binds to; undefined = not a translator,
 *  null = a translator whose namespace is not a literal (skipped). */
function translatorNamespace(init: ts.Expression | undefined): string | null | undefined {
  let expr = init
  while (expr && (ts.isAwaitExpression(expr) || ts.isParenthesizedExpression(expr))) expr = expr.expression
  if (!expr || !ts.isCallExpression(expr) || !ts.isIdentifier(expr.expression)) return undefined
  if (expr.expression.text !== 'useTranslations' && expr.expression.text !== 'getTranslations') return undefined
  const [arg] = expr.arguments
  if (!arg) return ''
  if (ts.isStringLiteralLike(arg)) return arg.text
  if (ts.isObjectLiteralExpression(arg)) {
    const ns = arg.properties.find(
      (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === 'namespace',
    )
    if (!ns) return ''
    return ts.isStringLiteralLike(ns.initializer) ? ns.initializer.text : null
  }
  return null
}

/** Every literal a key argument can evaluate to (`cond ? 'a' : 'b'` is both). */
function literalKeys(arg: ts.Expression | undefined): string[] | null {
  if (!arg) return null
  if (ts.isStringLiteralLike(arg)) return [arg.text]
  if (ts.isParenthesizedExpression(arg)) return literalKeys(arg.expression)
  if (ts.isConditionalExpression(arg)) {
    const a = literalKeys(arg.whenTrue)
    const b = literalKeys(arg.whenFalse)
    return a && b ? [...a, ...b] : null
  }
  return null
}

function collectUsages(): Usage[] {
  const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)))
  // noResolve + noLib: only the binder's symbol table is needed to tell which
  // declaration an identifier refers to, not types — this keeps the test fast.
  const program = ts.createProgram(files, {
    noResolve: true, noLib: true, allowJs: false, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext,
  })
  const checker = program.getTypeChecker()
  const usages: Usage[] = []

  for (const sf of program.getSourceFiles()) {
    if (!files.includes(resolve(sf.fileName))) continue
    const file = relative(ROOT, sf.fileName)
    const record = (node: ts.Node, key: string, kind: Kind) => {
      usages.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, key, kind })
    }

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        // translateOutsideReact('full.key')
        if (ts.isIdentifier(callee) && callee.text === 'translateOutsideReact') {
          for (const key of literalKeys(node.arguments[0]) ?? []) record(node, key, 'string')
        }
        // t('key') | t.rich('key') | t.markup('key') | t.raw('key')
        let target: ts.Identifier | undefined
        let kind: Kind = 'string'
        if (ts.isIdentifier(callee)) target = callee
        else if (
          ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
          && ['rich', 'markup', 'raw'].includes(callee.name.text)
        ) {
          target = callee.expression
          if (callee.name.text === 'raw') kind = 'raw'
        }
        if (target) {
          const decl = checker.getSymbolAtLocation(target)?.valueDeclaration
          const ns = decl && ts.isVariableDeclaration(decl) ? translatorNamespace(decl.initializer) : undefined
          const keys = typeof ns === 'string' ? literalKeys(node.arguments[0]) : null
          for (const key of keys ?? []) record(node, ns ? `${ns}.${key}` : key, kind)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return usages
}

const lookup = (path: string): unknown =>
  path.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' && part in node ? (node as Record<string, unknown>)[part] : undefined),
    de,
  )

describe('i18n keys used in code', () => {
  const usages = collectUsages()

  it('finds the translator calls at all (guards against the scanner going blind)', () => {
    // ~350 translators and well over a thousand literal calls today. A parser change
    // that silently matched nothing would make the test below pass vacuously.
    expect(usages.length).toBeGreaterThan(1000)
    expect(usages.some((u) => u.file === join('app', 'display', 'page.tsx'))).toBe(true)
  })

  it('every literal key resolves to a German message', () => {
    const missing = usages
      .filter(({ key, kind }) => {
        const value = lookup(key)
        return kind === 'raw' ? value === undefined : typeof value !== 'string'
      })
      .map(({ file, line, key }) => `${file}:${line} → ${key}`)
    expect(missing).toEqual([])
  })
})
