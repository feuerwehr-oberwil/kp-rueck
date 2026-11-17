/**
 * How a vehicle is named wherever it stands as a chip or a line: «TLF · Omega 1»
 * (name · Funkrufname), just the name when it has no call sign. On screen the
 * driver follows in brackets – «TLF · Omega 1 (Müller Hans)» – and text that
 * leaves the board writes «Fahrer: …» after it.
 *
 * Usage: `vehicleLabel({ name, callsign })`
 */
export function vehicleLabel({ name, callsign }: { name: string; callsign?: string | null }): string {
  return callsign ? `${name} · ${callsign}` : name
}
