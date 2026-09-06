import { describe, expect, it } from 'vitest'
import { classify } from './use-tile-availability'

// Was auf dem Kachel-Server liegt, entscheidet, WIE die Karte offline gezeichnet wird – und die
// naheliegende Antwort («nimm den ersten Eintrag») ist falsch: bei echten Vektorkacheln listet
// TileServer GL zuerst den serverseitig gerenderten Stil (`png`) und erst danach die Daten
// (`pbf`). Wer den ersten nimmt, hält eine Vektorinstallation für Raster. Und die leere
// Startdatei kann GAR NICHTS ausliefern – weder Stil noch Bildkacheln.

/** Was `/index.json` nach einem echten `just tiles-download` zurückgibt. */
const VECTOR_ENTRIES = [
  { name: 'Basic preview', format: 'png', minzoom: 0, maxzoom: 20 },
  {
    name: 'OpenMapTiles',
    id: 'basel-landschaft',
    format: 'pbf',
    description: 'A tileset showcasing all layers in OpenMapTiles.',
    minzoom: 0,
    maxzoom: 14,
  },
]

describe('classify', () => {
  it('erkennt echte Vektorkacheln am pbf-Eintrag, nicht am ersten', () => {
    const result = classify(VECTOR_ENTRIES)
    expect(result).toMatchObject({
      status: 'installed',
      format: 'vector',
      id: 'basel-landschaft',
      name: 'OpenMapTiles',
      maxzoom: 14,
    })
  })

  it('nimmt Bildkacheln nur, wenn es keine Vektordaten gibt', () => {
    const result = classify([
      { name: 'Luftbild', id: 'luftbild', format: 'png', minzoom: 8, maxzoom: 18 },
    ])
    expect(result).toMatchObject({ status: 'installed', format: 'raster', id: 'luftbild' })
  })

  it('meldet die leere Startdatei als bootstrap – sie liefert nichts aus', () => {
    const result = classify([
      { name: 'basel-landschaft', description: 'Bootstrap MBTiles – wird beim Download ersetzt' },
    ])
    expect(result.status).toBe('bootstrap')
  })

  it('lässt echte Kacheln neben der Startdatei gewinnen', () => {
    const result = classify([
      { name: 'basel-landschaft', description: 'Bootstrap MBTiles – wird beim Download ersetzt' },
      ...VECTOR_ENTRIES,
    ])
    expect(result).toMatchObject({ status: 'installed', format: 'vector' })
  })

  it('meldet ein leeres Verzeichnis als missing', () => {
    expect(classify([]).status).toBe('missing')
  })
})
