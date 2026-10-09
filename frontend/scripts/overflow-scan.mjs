#!/usr/bin/env node
/**
 * Overflow scan — visits every route and openable dialog of KP Rück at several widths and
 * themes and reports every element whose content overflows horizontally.
 *
 *   pnpm overflow-scan                       # all visits, 360/393/768/1280/1920, light + dark
 *   SCAN_ONLY=help,check-in SCAN_WIDTHS=360,393 pnpm overflow-scan
 *
 * Needs a running frontend (BASE_URL, default http://localhost:3000) whose backend has an
 * event with Einsätze (SCAN_EVENT=<id>, default: the most recently active live event).
 * LOCAL ONLY: it logs in, mints check-in / Feld / viewer / alarm / Reko links for that event and
 * names a Feld device — it refuses to run against anything but localhost/127.0.0.1.
 *
 * What counts (horizontal only; vertical scrolling is a list's job):
 *   page      — the document is wider than the viewport (the page scrolls sideways)
 *   sideways  — a box that scrolls vertically (a page body in the app shell, a list) also
 *               scrolls sideways: on a phone the whole screen slides; `overflow-x-auto` opts out
 *   offscreen — an element or text runs past the viewport edge and nothing clips or scrolls it
 *   spill     — text or a child runs out of its own box (overflow visible): it overlaps a neighbour
 *   clipped   — a hidden/clip box cuts its content off, with no ellipsis and no line-clamp
 *   escape    — an absolute box (an sr-only label) inside a scroller has its containing block
 *               outside it: it is not clipped with the scroller and stretches the page
 *   covered   — a control laid over a row (position absolute) lies on top of the row's text
 *   truncated — an ellipsis is cutting text that is not readable anywhere else (no title,
 *               aria-label or sr-only copy) — lower severity, reported separately
 * Horizontal scrollers (overflow-x auto/scroll), svg/canvas/map internals, sr-only text and
 * anything inside `[data-overflow-ok]` (a deliberate escape hatch — say why next to it) are ignored.
 *
 * Output: SCAN_OUT (default ./overflow-scan) → findings.json + findings.md, one line per
 * (visit, selector, kind) with the widths/themes it occurs at.
 *
 * Env: SCAN_EDITOR=editor:editor, SCAN_ADMIN=user:pass (for the admin-only settings sections;
 * skipped when unset), SCAN_BROWSER=chromium|webkit, SCAN_WEBKIT_EXECUTABLE (custom WebKit),
 * SCAN_THEMES=light,dark, SCAN_CONCURRENCY=3, SCAN_SHOTS=1 (a PNG per visit with findings; `all` for every visit — to check the visits reach their state).
 */
import { chromium, webkit } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const host = new URL(BASE).hostname
if (!['localhost', '127.0.0.1'].includes(host)) {
  console.error(`overflow-scan: refusing ${BASE} — it mints links and names a Feld device; local stacks only.`)
  process.exit(2)
}
const WIDTHS = (process.env.SCAN_WIDTHS || '360,393,768,1280,1920').split(',').map(Number)
const THEMES = (process.env.SCAN_THEMES || 'light,dark').split(',')
const ONLY = process.env.SCAN_ONLY ? process.env.SCAN_ONLY.split(',') : null
const OUT = path.resolve(process.env.SCAN_OUT || 'overflow-scan')
const CONCURRENCY = Number(process.env.SCAN_CONCURRENCY || 3)
const SHOTS = process.env.SCAN_SHOTS || '' // '1' = visits with findings, 'all' = every visit
const [EDITOR_USER, EDITOR_PASS] = (process.env.SCAN_EDITOR || 'editor:editor').split(':')
const ADMIN = process.env.SCAN_ADMIN ? process.env.SCAN_ADMIN.split(':') : null
const HEIGHT = (w) => (w < 500 ? 780 : w < 1000 ? 1024 : w < 1500 ? 860 : 1080)
fs.mkdirSync(OUT, { recursive: true })

// ── the in-page check ────────────────────────────────────────────────────────────────────────
// Kept free of closures over Node values: it is serialised into the page.
function scanPage() {
  const vw = document.documentElement.clientWidth
  const found = []
  const IGNORE = 'svg, canvas, video, iframe, .maplibregl-map, [data-overflow-ok], script, style, noscript, template'
  const cls = (el) =>
    [...el.classList].filter((c) => !/[:[\]/!]/.test(c) && c.length < 28).slice(0, 3).map((c) => '.' + c).join('')
  const selOf = (el) => {
    const parts = []
    for (let e = el, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) {
      let p = e.tagName.toLowerCase()
      if (e.id && !/^radix|^:r/.test(e.id)) { parts.unshift(p + '#' + e.id); break }
      const slot = e.getAttribute('data-slot')
      if (slot) p += `[data-slot=${slot}]`
      const tid = e.getAttribute('data-testid')
      if (tid) p += `[data-testid=${tid}]`
      p += cls(e)
      parts.unshift(p)
    }
    return parts.join(' > ')
  }
  const txt = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70)
  const isSrOnly = (el, cs) => cs.position === 'absolute' && (parseFloat(cs.width) <= 1 || cs.clip === 'rect(0px, 0px, 0px, 0px)')
  const hidden = (el, cs) =>
    cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0' || el.getClientRects().length === 0 ||
    (el.tagName === 'INPUT' && el.getAttribute('aria-hidden') === 'true') // Radix's bubble input behind a Checkbox
  const csCache = new Map()
  const cs = (el) => { let c = csCache.get(el); if (!c) { c = getComputedStyle(el); csCache.set(el, c) } return c }
  /** Does an ancestor that clips or scrolls horizontally, and is itself inside the viewport,
   *  hold this box? Then whatever runs past the viewport edge is cut or scrolled there, not
   *  painted off-screen (a kanban column scrolled out of view is not an overflow). */
  const heldInView = (el) => {
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      if (cs(e).overflowX === 'visible') continue
      const r = e.getBoundingClientRect()
      if (r.right <= vw + 1 && r.left >= -1) return true
    }
    return false
  }
  const readableElsewhere = (el) => {
    for (let e = el, i = 0; e && i < 4; e = e.parentElement, i++) {
      if (e.getAttribute('title') || e.getAttribute('aria-label')) return true
    }
    return !!el.parentElement?.querySelector(':scope > .sr-only')
  }
  const push = (kind, el, what) => found.push({ kind, sel: selOf(el), text: txt(el), what })
  const flagged = new Set()
  const flaggedAncestor = (el) => { for (let e = el.parentElement; e; e = e.parentElement) if (flagged.has(e)) return true; return false }

  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    found.push({ kind: 'page', sel: 'html', text: '', what: `page is ${document.documentElement.scrollWidth}px wide in a ${window.innerWidth}px viewport` })
  }

  // sideways: a box that scrolls VERTICALLY (a page body, a list) also scrolls sideways — on a
  // phone that is the whole screen sliding left. Boxes that are meant to scroll sideways say so
  // with `overflow-x-auto/-scroll` and are left alone (board columns, chip rows, tables).
  for (const sc of document.body.querySelectorAll('*')) {
    const c = cs(sc)
    if (!['auto', 'scroll'].includes(c.overflowY) || !['auto', 'scroll'].includes(c.overflowX)) continue
    if (/(^|\s)overflow-x-(auto|scroll)(\s|$)/.test(sc.className) || sc.tagName === 'PRE' || sc.closest(IGNORE)) continue
    if (hidden(sc, c) || sc.scrollWidth <= sc.clientWidth + 1) continue
    const sr = sc.getBoundingClientRect()
    // the outermost descendant that sticks out
    let culprit = null
    const stack = [...sc.children]
    while (stack.length && !culprit) {
      const e = stack.shift()
      const ec = cs(e)
      if (hidden(e, ec) || isSrOnly(e, ec) || ['absolute', 'fixed'].includes(ec.position)) continue
      const er = e.getBoundingClientRect()
      if (er.right > sr.right + 1 || er.left < sr.left - 1) {
        const inner = [...e.children].find((k) => { const kc = cs(k); if (hidden(k, kc) || ['absolute', 'fixed'].includes(kc.position)) return false; const kr = k.getBoundingClientRect(); return kr.right > sr.right + 1 || kr.left < sr.left - 1 })
        if (inner && e.getBoundingClientRect().width >= sr.width - 2) { stack.unshift(...e.children); continue }
        culprit = e
      }
    }
    found.push({ kind: 'sideways', sel: selOf(sc), text: culprit ? txt(culprit) : '', what: `scrolls sideways by ${sc.scrollWidth - sc.clientWidth}px${culprit ? ' — ' + selOf(culprit).split(' > ').slice(-2).join(' > ') : ''}` })
  }

  const all = document.body.querySelectorAll('*')
  for (const el of all) {
    if (el.closest(IGNORE)) continue
    const c = cs(el)
    if (hidden(el, c) || isSrOnly(el, c)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue

    // offscreen: the element itself runs past the viewport and nothing clips/scrolls it
    if ((r.right > vw + 1 || r.left < -1) && c.position !== 'fixed' && !flaggedAncestor(el)) {
      if (!heldInView(el)) {
        flagged.add(el)
        push('offscreen', el, `box ${Math.round(r.left)}…${Math.round(r.right)}px, viewport ${vw}px`)
        continue
      }
    }

    const ox = c.overflowX
    const over = el.scrollWidth - el.clientWidth
    // an inline `overflow: hidden` is a scroll LOCK set from script (the board under a footer
    // sheet), not a box that cuts its content
    if ((ox === 'hidden' || ox === 'clip') && over > 1 && el.clientWidth > 2 && el.style.overflow !== 'hidden') {
      if (c.textOverflow === 'ellipsis') {
        if (!readableElsewhere(el)) push('truncated', el, `ellipsis cuts ${over}px, no title/aria-label`)
      } else if (c.webkitLineClamp === 'none' || !c.webkitLineClamp) {
        // a box that clips: is TEXT cut? (a -mx-1 hover bleed or a rounded image tile cuts nothing)
        const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) })
        const tr0 = document.createRange()
        let cut = null
        for (let n = tw.nextNode(), i = 0; n && i < 400 && !cut; n = tw.nextNode(), i++) {
          const pe = n.parentElement
          if (!pe || pe.closest(IGNORE) || hidden(pe, cs(pe))) continue
          let inSr = false
          for (let e = pe; e && e !== el; e = e.parentElement) if (isSrOnly(e, cs(e)) || ['absolute', 'fixed'].includes(cs(e).position)) inSr = true
          if (inSr) continue
          tr0.selectNodeContents(n)
          const t = tr0.getBoundingClientRect()
          if (t.width > 1 && (t.right > r.right + 1 || t.left < r.left - 1)) cut = pe
        }
        if (cut) push('clipped', el, `${over}px cut off — «${txt(cut).slice(0, 40)}» (${selOf(cut).split(' > ').slice(-2).join(' > ')})`)
      }
    }
  }

  // covered: a control laid OVER a row (absolute) that sits on top of the row's own text
  const textIn = (root, skip) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.trim() && !skip.contains(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) })
    const out = []
    for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n)
    return out
  }
  const rng = document.createRange()
  for (const ov of document.body.querySelectorAll('a, button, [role=button]')) {
    if (ov.closest(IGNORE)) continue
    const oc = cs(ov)
    if (oc.position !== 'absolute' || hidden(ov, oc) || isSrOnly(ov, oc)) continue
    const or = ov.getBoundingClientRect()
    if (or.width < 12 || or.height < 12) continue
    const host = ov.offsetParent
    if (!host || host === document.body) continue
    for (const n of textIn(host, ov)) {
      const tp = n.parentElement
      if (!tp || hidden(tp, cs(tp)) || tp.closest('.sr-only')) continue
      // content that scrolls sideways under a control pinned over the scroller (the board's
      // reopen tabs) passes behind it by design — only text at rest under a control counts
      let scrolls = false
      for (let e = tp; e && e !== host; e = e.parentElement) {
        const o = cs(e).overflowX
        if ((o === 'auto' || o === 'scroll' || e.style.overflow === 'hidden') && e.scrollWidth > e.clientWidth + 1 && !e.contains(ov)) { scrolls = true; break }
      }
      if (scrolls) continue
      rng.selectNodeContents(n)
      for (const tr of rng.getClientRects()) {
        const ix = Math.min(tr.right, or.right) - Math.max(tr.left, or.left)
        const iy = Math.min(tr.bottom, or.bottom) - Math.max(tr.top, or.top)
        if (ix > 2 && iy > 2) {
          found.push({ kind: 'covered', sel: selOf(ov), text: n.nodeValue.trim().slice(0, 70), what: `overlay «${(ov.getAttribute('aria-label') || txt(ov)).slice(0, 30)}» lies on the text` })
          break
        }
      }
    }
  }

  // escape: absolute boxes (sr-only labels above all) inside a scroller whose containing block
  // lies OUTSIDE it — they are not clipped or scrolled with it and stretch the page instead (a
  // 21-card list made the whole document 2500px tall; the Wandanzeige status page 513px wide)
  const escaped = new Set()
  for (const ab of document.body.querySelectorAll('.sr-only, [class*="absolute"]')) {
    const ac = cs(ab)
    if (ac.position !== 'absolute' || ab.closest(IGNORE)) continue
    let scroller = null
    for (let e = ab.parentElement; e && e !== document.body; e = e.parentElement) {
      if (cs(e).overflowX !== 'visible' || cs(e).overflowY !== 'visible') { scroller = e; break }
      if (cs(e).position !== 'static') break // contained before any scroller: fine
    }
    if (!scroller || escaped.has(scroller)) continue
    const cb = ab.offsetParent
    if (cb && (cb === scroller || scroller.contains(cb))) continue
    escaped.add(scroller)
    found.push({ kind: 'escape', sel: selOf(scroller), text: txt(ab).slice(0, 40), what: `absolute ${ab.classList.contains('sr-only') ? 'sr-only ' : ''}box escapes this scroller (no positioned ancestor inside it) — give the scroller \`relative\`` })
  }

  // placeholders are no text nodes: measured with the field's own font
  const meas = document.createElement('canvas').getContext('2d')
  for (const f of document.body.querySelectorAll('input[placeholder]')) { // a textarea's placeholder wraps
    if (f.value || f.closest(IGNORE)) continue
    const fc = cs(f)
    if (hidden(f, fc) || isSrOnly(f, fc)) continue
    meas.font = `${fc.fontStyle} ${fc.fontWeight} ${fc.fontSize} ${fc.fontFamily}`
    const need = meas.measureText(f.placeholder).width
    const room = f.clientWidth - parseFloat(fc.paddingLeft) - parseFloat(fc.paddingRight)
    if (room > 0 && need > room + 2) push('clipped', f, `placeholder «${f.placeholder}» needs ${Math.round(need)}px, has ${Math.round(room)}px`)
  }

  // text runs: each visible text node against its own block box (spill) and the viewport (offscreen)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  })
  const range = document.createRange()
  const seen = new Set()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement
    if (!p || p.closest(IGNORE)) continue
    let box = p
    while (box && ['inline', 'contents'].includes(cs(box).display)) box = box.parentElement
    if (!box || seen.has(box)) continue
    const pc = cs(p)
    if (hidden(p, pc) || isSrOnly(p, pc) || isSrOnly(box, cs(box))) continue
    let skip = false
    for (let e = p; e && e !== document.body; e = e.parentElement) if (isSrOnly(e, cs(e)) || cs(e).opacity === '0') { skip = true; break }
    if (skip) continue
    range.selectNodeContents(n)
    const tr = range.getBoundingClientRect()
    if (tr.width < 1) continue
    const br = box.getBoundingClientRect()
    const bc = cs(box)
    const inner = { left: br.left + parseFloat(bc.borderLeftWidth), right: br.right - parseFloat(bc.borderRightWidth) }
    if (tr.right > inner.right + 1 || tr.left < inner.left - 1) {
      seen.add(box)
      if (bc.overflowX === 'visible' && !flaggedAncestor(box)) {
        push('spill', box, `text runs ${Math.round(Math.max(tr.right - inner.right, inner.left - tr.left))}px out of its box`)
      }
      continue
    }
    if ((tr.right > vw + 1 || tr.left < -1) && !flaggedAncestor(box)) {
      const boxHolds = bc.overflowX !== 'visible' && br.right <= vw + 1 && br.left >= -1
      if (!boxHolds && !heldInView(box)) {
        seen.add(box)
        push('offscreen', box, `text ends at ${Math.round(tr.right)}px, viewport ${vw}px`)
      }
    }
  }
  return found
}

// ── visits ───────────────────────────────────────────────────────────────────────────────────
const phone = (w) => w < 768
const click = async (page, name, opts = {}) => {
  const l = page.getByRole(opts.role || 'button', { name }).filter({ visible: true }).first()
  await l.click({ timeout: opts.timeout ?? 6000 })
  await page.waitForTimeout(opts.wait ?? 900)
}
const openMehr = (page) => click(page, /^Mehr/)
const firstCard = async (page) => {
  // desktop board card, else the phone list's card
  const c = page.locator('[data-testid=incident-card], [data-slot=card].cursor-pointer').filter({ visible: true }).first()
  // force: the card's timer re-renders every second, which Playwright's «stable» check can
  // wait out for a long time on a loaded machine
  await c.click({ timeout: 15000, force: true })
  await page.waitForTimeout(1500)
}

function visits(links) {
  const v = [
    { id: 'login', path: '/login', role: null },
    { id: 'setup', path: '/setup', role: null },
    { id: 'board', path: '/' },
    { id: 'board-detail', path: '/', act: firstCard },
    { id: 'setup-checklist', path: '/', checklist: true, desktopOnly: true },
    { id: 'new-incident', path: '/', act: async (p, w) => (phone(w) ? click(p, /Neuer Einsatz/) : (await p.keyboard.press('n'), p.waitForTimeout(1200))) },
    { id: 'cmdk', path: '/', act: async (p) => { await p.keyboard.press('Control+k'); await p.waitForTimeout(900) } },
    { id: 'shortcuts', path: '/', act: async (p) => { await p.keyboard.press('Shift+?'); await p.waitForTimeout(900) } },
    { id: 'mehr', path: '/', phoneOnly: true, act: openMehr },
    { id: 'links-qr', path: '/', act: async (p, w) => { if (phone(w)) await openMehr(p); await click(p, /Links/) } },
    { id: 'appell', path: '/', act: async (p, w) => { if (phone(w)) await openMehr(p); await click(p, /Links/); await click(p, /Appell öffnen/, { wait: 1500 }) } },
    { id: 'auftraege', path: '/', desktopOnly: true, act: (p) => click(p, /Aufträge/) },
    { id: 'personnel', path: '/', phoneOnly: true, act: async (p) => { await openMehr(p); await click(p, /^Personal/) } },
    { id: 'crew-duty', path: '/', act: async (p, w) => { if (phone(w)) { await openMehr(p); await click(p, /^Personal/) } await click(p, /^Dienstzeiten/, { wait: 1500 }) } },
    { id: 'vehicles', path: '/', act: async (p, w) => { if (phone(w)) await openMehr(p); await click(p, /Fahrzeug/) } },
    { id: 'print', path: '/', act: async (p, w) => { if (phone(w)) await openMehr(p); await click(p, /Drucken/) } },
    { id: 'map', path: '/map' },
    { id: 'events', path: '/events' },
    { id: 'events-create', path: '/events?action=create' },
    { id: 'help', path: '/help' },
    { id: 'resources', path: '/resources' },
    { id: 'training', path: '/training' },
    { id: 'divera-pool', path: '/divera-pool' },
    { id: 'admin-audit', path: '/admin/audit' },
    { id: 'admin-import', path: '/admin/import' },
    ...['device', 'general', 'integrations', 'printer', 'gps', 'alerting', 'alarmIntake', 'notifications', 'checklist',
      'auftragTemplates', 'fallback', 'personnel', 'vehicles', 'materials', 'import', 'audit', 'telemetry']
      .map((s) => ({ id: `settings-${s}`, path: `/settings?section=${s}` })),
    ...(ADMIN ? ['users', 'sync'].map((s) => ({ id: `settings-${s}`, path: `/settings?section=${s}`, role: 'admin' })) : []),
  ]
  if (links.checkin) v.push({ id: 'check-in', path: links.checkin, role: null })
  if (links.alarm) v.push({ id: 'alarm', path: links.alarm, role: null })
  if (links.reko) v.push({ id: 'reko', path: links.reko, role: null })
  if (links.viewer) {
    for (const d of ['', '/board', '/map', '/status']) v.push({ id: `display${d.replace('/', '-') || '-root'}`, path: `/display${d}?token=${links.viewer}`, role: null })
  }
  if (links.feld) {
    const feldCode = async (p) => { await p.keyboard.type(links.feldCode); await p.waitForTimeout(2500) }
    const feldClaim = async (p) => {
      await feldCode(p)
      const row = p.getByRole('button').filter({ hasText: links.feldPerson }).filter({ visible: true }).first()
      await row.click({ timeout: 6000 }); await p.waitForTimeout(1500)
      const confirm = p.getByRole('button', { name: /Das bin ich|Bestätigen|Weiter|Ja/ }).filter({ visible: true }).first()
      if (await confirm.count()) { await confirm.click(); await p.waitForTimeout(2000) }
    }
    v.push({ id: 'feld-code', path: links.feld, role: null, fresh: true })
    v.push({ id: 'feld-names', path: links.feld, role: null, fresh: true, act: feldCode })
    v.push({ id: 'feld-assignments', path: links.feld, role: null, fresh: true, act: feldClaim })
    v.push({
      id: 'feld-detail', path: links.feld, role: null, fresh: true,
      act: async (p) => {
        await feldClaim(p)
        await p.locator('button').filter({ hasText: links.feldIncident }).filter({ visible: true }).first().click({ timeout: 6000 })
        await p.waitForTimeout(1500)
      },
    })
  }
  return ONLY ? v.filter((x) => ONLY.some((o) => x.id === o || x.id.startsWith(o + '-') || x.id.startsWith(o))) : v
}

// ── setup: login, links ──────────────────────────────────────────────────────────────────────
async function api(ctx, method, url, form) {
  const r = await ctx.request[method](BASE + '/backend-api' + url, form ? { form } : {})
  if (!r.ok()) throw new Error(`${method.toUpperCase()} ${url} → ${r.status()}`)
  return r.json()
}

async function loginState(browser, user, pass, file) {
  const ctx = await browser.newContext()
  await api(ctx, 'post', '/api/auth/login', { username: user, password: pass })
  await ctx.storageState({ path: file })
  return ctx
}

async function prepare(browser) {
  const editorFile = path.join(OUT, '.state-editor.json')
  const ctx = await loginState(browser, EDITOR_USER, EDITOR_PASS, editorFile)
  const states = { editor: editorFile, admin: null }
  if (ADMIN) {
    states.admin = path.join(OUT, '.state-admin.json')
    await (await loginState(browser, ADMIN[0], ADMIN[1], states.admin)).close()
  }
  const { events } = await api(ctx, 'get', '/api/events/')
  const ev = process.env.SCAN_EVENT
    ? events.find((e) => e.id === process.env.SCAN_EVENT)
    : events.filter((e) => !e.archived_at && !e.training_flag && e.incident_count > 0).sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at))[0]
  if (!ev) throw new Error('no event with Einsätze — seed one or set SCAN_EVENT')
  const links = { event: ev }
  const tryLink = async (key, fn) => { try { links[key] = await fn() } catch (e) { console.warn(`link ${key}: ${e.message}`) } }
  const q = `?event_id=${ev.id}`
  await tryLink('checkin', async () => (await api(ctx, 'post', '/api/personnel/check-in/generate-link' + q)).link)
  await tryLink('alarm', async () => (await api(ctx, 'post', '/api/intake/generate-link' + q)).link)
  await tryLink('viewer', async () => (await api(ctx, 'post', '/api/viewer/generate-link' + q)).token)
  await tryLink('feld', async () => (await api(ctx, 'post', '/api/feld/generate-link' + q)).link)
  await tryLink('feldCode', async () => (await api(ctx, 'get', '/api/feld/access' + q)).code)
  const incidents = await api(ctx, 'get', `/api/incidents/?event_id=${ev.id}`)
  const list = Array.isArray(incidents) ? incidents : incidents.incidents || incidents.items || []
  if (list[0]) {
    await tryLink('reko', async () => {
      const r = await api(ctx, 'post', `/api/reko/generate-link?incident_id=${list[0].id}`)
      return r.link
    })
  }
  // the Feld detail needs a person who is assigned somewhere: the first assignment we find
  await tryLink('feldPerson', async () => {
    for (const inc of list) {
      const a = await api(ctx, 'get', `/api/incidents/${inc.id}/assignments`).catch(() => [])
      const person = (Array.isArray(a) ? a : a.assignments || []).find((x) => x.resource_type === 'personnel')
      if (person) {
        links.feldIncident = inc.location_address?.split(',')[0] || inc.title
        const p = await api(ctx, 'get', `/api/personnel/${person.resource_id}`)
        return p.name
      }
    }
    throw new Error('no personnel assignment in the event — the Feld detail visit will fail')
  })
  await ctx.close()
  return { states, links }
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────
const HYGIENE = `*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}
nextjs-portal{display:none!important}`

async function runVisit(browser, states, visit, width, theme) {
  const role = visit.role === undefined ? 'editor' : visit.role
  const ctx = await browser.newContext({
    viewport: { width, height: HEIGHT(width) },
    deviceScaleFactor: 1,
    isMobile: browser.browserType().name() === 'chromium' ? phone(width) : undefined,
    hasTouch: phone(width),
    colorScheme: theme,
    storageState: role ? states[role] || states.editor : undefined,
  })
  await ctx.addInitScript(([t, ev, checklist]) => {
    try {
      localStorage.setItem('theme', t)
      localStorage.setItem('kp-rueck-selected-event', ev)
      // the Bereitschaft checklist opens by itself once per event — closed here, except for the
      // visit that is about it, so it does not stand in front of every other one
      if (!checklist) localStorage.setItem('kp-board-checklistDismissedEvents', JSON.stringify([ev]))
    } catch { /* storage disabled: the page simply starts on its defaults */ }
  }, [theme, visit.event ?? globalThis.__scanEvent, !!visit.checklist])
  const page = await ctx.newPage()
  let error = null
  let found = []
  try {
    await page.goto(BASE + visit.path, { waitUntil: 'commit', timeout: 30000 })
    // not 'networkidle': the board polls and holds a socket, so it never goes idle
    await page.waitForTimeout(Number(process.env.SCAN_SETTLE_MS || 3500))
    await page.addStyleTag({ content: HYGIENE }).catch(() => {})
    for (const name of [/Los geht/, /Alle schliessen/]) {
      const b = page.getByRole('button', { name }).filter({ visible: true })
      if (await b.count()) await b.first().click().catch(() => {})
    }
    if (visit.act) await visit.act(page, width)
    await page.waitForTimeout(500)
    found = await page.evaluate(scanPage)
    if (SHOTS === 'all' || (SHOTS && found.some((f) => f.kind !== 'truncated'))) {
      fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true })
      await page.screenshot({ path: path.join(OUT, 'shots', `${visit.id}-${width}-${theme}.png`) })
    }
  } catch (e) {
    error = e.message.split('\n')[0]
    if (SHOTS) {
      fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true })
      await page.screenshot({ path: path.join(OUT, 'shots', `ERR-${visit.id}-${width}-${theme}.png`) }).catch(() => {})
    }
  }
  await ctx.close()
  return { found, error, url: visit.path }
}

const browserType = process.env.SCAN_BROWSER === 'webkit' ? webkit : chromium
const browser = await browserType.launch(process.env.SCAN_WEBKIT_EXECUTABLE && browserType === webkit ? { executablePath: process.env.SCAN_WEBKIT_EXECUTABLE } : {})
const { states, links } = await prepare(browser)
globalThis.__scanEvent = links.event.id
const all = visits(links)
const jobs = []
for (const visit of all) for (const width of WIDTHS) {
  if (visit.phoneOnly && !phone(width)) continue
  if (visit.desktopOnly && phone(width)) continue
  for (const theme of THEMES) jobs.push({ visit, width, theme })
}
console.log(`overflow-scan: ${all.length} visits × widths × themes = ${jobs.length} page loads against ${BASE} (event «${links.event.name}»)`)

const results = []
let next = 0
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < jobs.length) {
    const job = jobs[next++]
    const r = await runVisit(browser, states, job.visit, job.width, job.theme)
    results.push({ ...job, ...r })
    const n = r.found.filter((f) => f.kind !== 'truncated').length
    console.log(`${r.error ? 'ERR ' : n ? 'OVER' : 'ok  '} ${job.visit.id} ${job.width} ${job.theme}${n ? ` · ${n}` : ''}${r.error ? ` · ${r.error}` : ''}`)
  }
}))
await browser.close()

// ── report ───────────────────────────────────────────────────────────────────────────────────
const agg = new Map()
for (const r of results) for (const f of r.found) {
  const key = `${r.visit.id}|${f.kind}|${f.sel}`
  const a = agg.get(key) || { visit: r.visit.id, url: r.url, ...f, at: new Set() }
  a.at.add(`${r.width}${r.theme === 'dark' ? 'd' : 'l'}`)
  agg.set(key, a)
}
const rows = [...agg.values()].map((a) => ({ ...a, at: [...a.at].sort((x, y) => parseInt(x) - parseInt(y)) }))
const order = { page: 0, sideways: 0, escape: 1, offscreen: 1, spill: 2, clipped: 3, covered: 4, truncated: 5 }
rows.sort((a, b) => order[a.kind] - order[b.kind] || a.visit.localeCompare(b.visit))
const errors = results.filter((r) => r.error).map((r) => `${r.visit.id} ${r.width} ${r.theme}: ${r.error}`)
fs.writeFileSync(path.join(OUT, 'findings.json'), JSON.stringify({ base: BASE, rows, errors }, null, 2))
const count = (k) => rows.filter((r) => r.kind === k).length
const md = [
  `# Overflow scan — ${new Date().toISOString().slice(0, 16)} — ${BASE}`,
  '',
  `${jobs.length} page loads · widths ${WIDTHS.join('/')} · ${THEMES.join('+')} · ${browserType.name()}`,
  '',
  `**${rows.length - count('truncated')} overflow findings** (page ${count('page')}, sideways ${count('sideways')}, escape ${count('escape')}, offscreen ${count('offscreen')}, spill ${count('spill')}, clipped ${count('clipped')}, covered ${count('covered')}) + ${count('truncated')} truncations without a readable full text. ${errors.length} visits failed.`,
  '',
  '| kind | visit | widths | selector | text | what |',
  '|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.kind} | ${r.visit} | ${r.at.join(' ')} | \`${r.sel.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')}\` | ${r.text.replace(/\|/g, '/')} | ${r.what.replace(/\|/g, '/')} |`),
  '',
  errors.length ? '## Visits that failed\n\n' + errors.map((e) => `- ${e}`).join('\n') : '',
].join('\n')
fs.writeFileSync(path.join(OUT, 'findings.md'), md)
console.log(`\n${rows.length - count('truncated')} findings + ${count('truncated')} truncations, ${errors.length} failed visits → ${OUT}/findings.md`)
