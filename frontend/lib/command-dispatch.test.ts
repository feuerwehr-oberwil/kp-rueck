import { describe, expect, it } from "vitest"

import de from "@/messages/de.json"
import fr from "@/messages/fr.json"

import {
  completeDispatch,
  fold,
  parseDispatch,
  targetKey,
  type DispatchPlan,
  type DispatchVocabulary,
} from "./command-dispatch"

const vocabulary: DispatchVocabulary = {
  incidents: [
    { id: "inc-14", number: 14, label: "Bachweg 3", status: "incoming", priority: "medium" },
    { id: "inc-12", number: 12, label: "Hauptstrasse 1", status: "active", priority: "high" },
    { id: "inc-1", number: 1, label: "Kirchgasse 2", status: "reko", priority: "low" },
  ],
  persons: [
    { id: "p-muster", name: "Muster Peter", detail: "Maschinist" },
    { id: "p-meier-hans", name: "Meier Hans", detail: "Gruppenführer", incidentIds: ["inc-12"] },
    { id: "p-meier-anna", name: "Meier Anna", detail: "AdF" },
    { id: "p-mueller", name: "Müller René" },
    { id: "p-schneider", name: "Schneider Peter", incidentIds: ["inc-14"] },
  ],
  vehicles: [
    { id: "v-tlf", name: "TLF", type: "TLF", callSign: "Omega 1" },
    { id: "v-pio", name: "Pio", type: "Pio" },
    { id: "v-mtw1", name: "MTW 1", type: "MTW" },
    { id: "v-mtw2", name: "MTW 2", type: "MTW" },
  ],
  materials: [
    { id: "m-pumpe-1", name: "Tauchpumpe", available: false, incidentIds: ["inc-12"] },
    { id: "m-pumpe-2", name: "Tauchpumpe", available: true },
    { id: "m-saege", name: "Motorsäge" },
  ],
}

const parse = (input: string, picks = {}) => parseDispatch(input, vocabulary, picks)

function dispatchOf(plan: DispatchPlan) {
  if (plan.kind !== "dispatch") throw new Error(`expected a dispatch, got ${JSON.stringify(plan)}`)
  return plan
}

describe("fold", () => {
  it("drops case, diacritics and ß", () => {
    expect(fold("Müller")).toBe("muller")
    expect(fold("Clôturé")).toBe("cloture")
    expect(fold("Strasse")).toBe(fold("Straße"))
  })
})

describe("parseDispatch — the owner's examples", () => {
  it("14 tlf muster → assign TLF and Muster to Einsatz 14", () => {
    const plan = dispatchOf(parse("14 tlf muster").plan)
    expect(plan.incident.id).toBe("inc-14")
    expect(plan.assign.map((entry) => entry.target.id)).toEqual(["v-tlf", "p-muster"])
    expect(plan.status).toBeNull()
    expect(plan.priority).toBeNull()
    expect(plan.noop).toBe(false)
  })

  it("takes the words after the number in any order", () => {
    const plan = dispatchOf(parse("14 muster tlf").plan)
    expect(plan.assign.map((entry) => entry.target.id)).toEqual(["p-muster", "v-tlf"])
  })

  it("needs no special characters, and does not mind them either", () => {
    expect(dispatchOf(parse("14 + tlf + muster").plan).assign).toHaveLength(2)
    expect(dispatchOf(parse("#14 tlf, muster").plan).assign).toHaveLength(2)
    expect(dispatchOf(parse("14 > einsatz").plan).status).toBe("active")
    expect(dispatchOf(parse("14 !hoch").plan).priority).toBe("high")
  })

  it("14 einsatz / 14 disponiert move the status, prefixes included", () => {
    expect(dispatchOf(parse("14 einsatz").plan).status).toBe("active")
    expect(dispatchOf(parse("14 im einsatz").plan).status).toBe("active")
    expect(dispatchOf(parse("14 disponiert").plan).status).toBe("enroute")
    expect(dispatchOf(parse("14 dispo").plan).status).toBe("enroute")
    expect(dispatchOf(parse("14 anf").plan).status).toBe("enroute")
  })

  it("understands the French status words", () => {
    expect(dispatchOf(parse("14 intervention").plan).status).toBe("active")
    expect(dispatchOf(parse("14 en intervention").plan).status).toBe("active")
    expect(dispatchOf(parse("14 engagé").plan).status).toBe("enroute")
    expect(dispatchOf(parse("14 engage").plan).status).toBe("enroute")
    expect(dispatchOf(parse("14 retour").plan).status).toBe("returning")
    expect(dispatchOf(parse("14 clôturé").plan).status).toBe("complete")
  })

  it("tells Reko from Reko abgeschlossen, and Abgeschlossen from both", () => {
    expect(dispatchOf(parse("14 reko").plan).status).toBe("reko")
    expect(dispatchOf(parse("14 reko abgeschlossen").plan).status).toBe("reko_done")
    expect(dispatchOf(parse("14 abgeschlossen").plan).status).toBe("complete")
    expect(dispatchOf(parse("14 terminé").plan).status).toBe("returning")
  })

  it("14 hoch sets the priority (de + fr)", () => {
    expect(dispatchOf(parse("14 hoch").plan).priority).toBe("high")
    expect(dispatchOf(parse("14 haute").plan).priority).toBe("high")
    expect(dispatchOf(parse("14 niedrig").plan).priority).toBe("low")
  })

  it("combines everything in one line", () => {
    const plan = dispatchOf(parse("14 tlf muster einsatz hoch").plan)
    expect(plan.assign).toHaveLength(2)
    expect(plan.status).toBe("active")
    expect(plan.priority).toBe("high")
  })

  it("meier hans alone jumps to the person; tlf to the vehicle", () => {
    expect(parse("meier hans").plan).toMatchObject({ kind: "jump", target: { id: "p-meier-hans" }, exact: true })
    expect(parse("tlf").plan).toMatchObject({ kind: "jump", target: { id: "v-tlf" }, exact: true })
    expect(parse("motors").plan).toMatchObject({ kind: "jump", target: { id: "m-saege" }, exact: false })
  })

  it("14 alone opens the Einsatz", () => {
    expect(parse("14").plan).toMatchObject({ kind: "open", incident: { id: "inc-14" } })
    expect(parse("#14").plan).toMatchObject({ kind: "open", incident: { id: "inc-14" } })
  })
})

describe("parseDispatch — names", () => {
  it("matches the last name, the first name, or both in either order", () => {
    expect(parse("muster").plan).toMatchObject({ kind: "jump", target: { id: "p-muster" } })
    expect(parse("rene").plan).toMatchObject({ kind: "jump", target: { id: "p-mueller" } })
    expect(parse("hans meier").plan).toMatchObject({ kind: "jump", target: { id: "p-meier-hans" } })
    expect(parse("meier hans").plan).toMatchObject({ kind: "jump", target: { id: "p-meier-hans" } })
  })

  it("matches prefixes", () => {
    expect(parse("must").plan).toMatchObject({ kind: "jump", target: { id: "p-muster" }, exact: false })
    expect(dispatchOf(parse("14 mus tl").plan).assign.map((entry) => entry.target.id)).toEqual(["p-muster", "v-tlf"])
  })

  it("ignores diacritics and accepts the transcription", () => {
    for (const typed of ["müller", "muller", "mueller", "MÜLLER"]) {
      expect(parse(typed).plan).toMatchObject({ kind: "jump", target: { id: "p-mueller" } })
    }
  })

  it("forgives one typo from four letters on", () => {
    expect(parse("mustr").plan).toMatchObject({ kind: "jump", target: { id: "p-muster" } })
    expect(parse("schnieder").plan).toMatchObject({ kind: "jump", target: { id: "p-schneider" } })
    // …but not on short tokens, where one letter is half the word.
    expect(parse("mxs").plan).toEqual({ kind: "none" })
  })

  it("prefers a whole word over a prefix over a typo", () => {
    // «peter» is the first name of two people — a genuine «which one?».
    const { tokens, plan } = parse("14 peter")
    expect(plan).toMatchObject({ kind: "blocked", reason: "ambiguous" })
    expect(tokens[1].choices?.map((choice) => targetKey(choice))).toEqual(["person:p-muster", "person:p-schneider"])
  })

  it("shows choices for an ambiguous name instead of guessing", () => {
    const { tokens, plan } = parse("14 meier tlf")
    expect(plan).toMatchObject({ kind: "blocked", reason: "ambiguous", incident: { id: "inc-14" } })
    expect(tokens.map((token) => token.state)).toEqual(["incident", "ambiguous", "match"])
    expect(tokens[1].choices?.map((choice) => choice.kind === "person" && choice.id)).toEqual([
      "p-meier-hans",
      "p-meier-anna",
    ])
  })

  it("a pick resolves the ambiguity, keyed on what was typed", () => {
    const first = parse("14 meier tlf")
    const picks = { [first.tokens[1].pickKey]: "person:p-meier-anna" }
    const plan = dispatchOf(parse("14 meier tlf", picks).plan)
    expect(plan.assign.map((entry) => entry.target.id)).toEqual(["p-meier-anna", "v-tlf"])
    // A pick only answers the question it was given: another word is untouched.
    expect(parse("14 peter", picks).plan).toMatchObject({ kind: "blocked", reason: "ambiguous" })
  })

  it("one ambiguous name blocks the jump as well", () => {
    expect(parse("meier").plan).toMatchObject({ kind: "blocked", reason: "ambiguous", incident: null })
  })
})

describe("parseDispatch — nothing lands on an Einsatz by a guess", () => {
  it("a typo-only match asks «meintest du?» instead of assigning", () => {
    const { tokens, plan } = parse("14 mustr tlf")
    expect(plan).toMatchObject({ kind: "blocked", reason: "ambiguous", incident: { id: "inc-14" } })
    expect(tokens[1]).toMatchObject({ state: "ambiguous", confirm: "typo", choices: [{ id: "p-muster" }] })
    // The pick is the confirmation.
    const plan2 = dispatchOf(parse("14 mustr tlf", { [tokens[1].pickKey]: "person:p-muster" }).plan)
    expect(plan2.assign.map((entry) => entry.target.id)).toEqual(["p-muster", "v-tlf"])
  })

  it("a typo is still fine for a jump, which changes nothing", () => {
    expect(parse("mustr").plan).toMatchObject({ kind: "jump", target: { id: "p-muster" } })
  })

  it("«rene schneider» – a first name and a surname of two people – asks first", () => {
    // Nobody is called René Schneider; there is a Müller René and a Schneider Peter.
    const { tokens, plan } = parse("14 rene schneider")
    expect(plan).toMatchObject({ kind: "blocked", reason: "ambiguous" })
    expect(tokens.slice(1).map((token) => [token.state, token.confirm])).toEqual([
      ["ambiguous", "split"],
      ["ambiguous", "split"],
    ])
    const picks = { [tokens[1].pickKey]: "person:p-mueller", [tokens[2].pickKey]: "person:p-schneider" }
    expect(dispatchOf(parse("14 rene schneider", picks).plan).assign).toHaveLength(2)
  })

  it("two surnames are two people, as typed", () => {
    expect(dispatchOf(parse("14 schneider muster").plan).assign.map((entry) => entry.target.id)).toEqual([
      "p-schneider",
      "p-muster",
    ])
  })

  it("a name that is also a status or priority word is a «which one?»", () => {
    const withHoch: DispatchVocabulary = {
      ...vocabulary,
      persons: [...vocabulary.persons, { id: "p-hoch", name: "Hoch Martin" }, { id: "p-neu", name: "Neu Sara" }],
    }
    for (const word of ["hoch", "neu"]) {
      const { tokens, plan } = parseDispatch(`14 ${word}`, withHoch)
      expect(plan).toMatchObject({ kind: "blocked", reason: "ambiguous" })
      expect(tokens[1].choices?.map((choice) => choice.kind).sort()).toEqual(
        word === "hoch" ? ["person", "priority"] : ["person", "status"],
      )
    }
    // Without such a person the word is just the word.
    expect(dispatchOf(parse("14 hoch").plan).priority).toBe("high")
  })
})

describe("parseDispatch — the Einsatz by its address or Einsatzart", () => {
  // A board with two Einsätze on one street, a person named like a street word,
  // and an Einsatzart that appears once.
  const street: DispatchVocabulary = {
    ...vocabulary,
    incidents: [
      ...vocabulary.incidents,
      { id: "inc-15", number: 15, label: "Bachweg 14", status: "incoming", priority: "low" },
      { id: "inc-16", number: 16, label: "Brunnenweg 2", type: "Strassenrettung", status: "incoming", priority: "low" },
      { id: "inc-17", number: 17, label: "Rosenweg 9", status: "incoming", priority: "low" },
      { id: "inc-18", number: 18, label: "Neuweg 4", status: "incoming", priority: "low" },
    ],
    persons: [...vocabulary.persons, { id: "p-bach", name: "Bach Anna" }, { id: "p-rosen", name: "Rosenweg Tim" }],
  }
  const p = (input: string, picks = {}) => parseDispatch(input, street, picks)

  it("«bachweg 3 tlf muster» – street and house number, then the rest", () => {
    const plan = dispatchOf(p("bachweg 3 tlf muster").plan)
    expect(plan.incident.id).toBe("inc-14")
    expect(plan.assign.map((entry) => entry.target.id)).toEqual(["v-tlf", "p-muster"])
  })

  it("the address ends where a vehicle, person or status word begins", () => {
    const plan = dispatchOf(p("hauptstrasse 1 tlf hoch").plan)
    expect(plan.incident.id).toBe("inc-12")
    expect(plan.assign.map((entry) => entry.target.id)).toEqual(["v-tlf"])
    expect(dispatchOf(p("brunnenweg 2 einsatz").plan)).toMatchObject({ incident: { id: "inc-16" }, status: "active" })
  })

  it("the house number picks between two Einsätze on one street", () => {
    expect(dispatchOf(p("bachweg 14 tlf").plan).incident.id).toBe("inc-15")
    expect(dispatchOf(p("bachw 3 tlf").plan).incident.id).toBe("inc-14")
  })

  it("a street with two Einsätze and no house number asks which one", () => {
    const { tokens, plan } = p("bachweg tlf")
    expect(plan).toMatchObject({ kind: "blocked", reason: "ambiguous", incident: null })
    expect(tokens[0].choices?.map((choice) => targetKey(choice))).toEqual(["incident:inc-14", "incident:inc-15"])
    const picked = dispatchOf(p("bachweg tlf", { [tokens[0].pickKey]: "incident:inc-15" }).plan)
    expect(picked.incident.id).toBe("inc-15")
  })

  it("a beginning of a street opens its Einsatz – marked loose, so commands keep ↵", () => {
    expect(p("brunnenw").plan).toMatchObject({ kind: "open", incident: { id: "inc-16" }, loose: true })
    expect(p("brunnenweg 2").plan).toMatchObject({ kind: "open", incident: { id: "inc-16" }, loose: false })
    expect(p("14").plan).toMatchObject({ kind: "open", incident: { id: "inc-14" }, loose: false })
  })

  it("a house number alone is never an address – «14» is Einsatz 14, not «Bachweg 14»", () => {
    expect(p("14 tlf").plan).toMatchObject({ kind: "dispatch", incident: { id: "inc-14" } })
    expect(p("tlf 14").plan).toMatchObject({ kind: "dispatch", incident: { id: "inc-14" } })
  })

  it("a person named like a street: the whole word wins, a tie across kinds asks", () => {
    // «bach» is all of Anna Bach's surname and only the start of «Bachweg».
    expect(p("bach").plan).toMatchObject({ kind: "jump", target: { id: "p-bach" } })
    // «rosenweg» is a whole word of both the street and Tim Rosenweg.
    const { tokens, plan } = p("rosenweg tlf")
    expect(plan).toMatchObject({ kind: "blocked", reason: "ambiguous" })
    expect(tokens[0].choices?.map((choice) => choice.kind).sort()).toEqual(["incident", "person"])
  })

  it("a status word stays a status word next to a street that starts like it", () => {
    expect(dispatchOf(p("14 neu").plan).status).toBeNull() // already «Eingegangen»
    expect(p("14 neu").tokens[1].target).toEqual({ kind: "status", status: "incoming" })
  })

  it("names the Einsatz by its Einsatzart when that is unique", () => {
    expect(dispatchOf(p("strassenrettung tlf").plan).incident.id).toBe("inc-16")
  })

  it("an address found only through a typo asks «meintest du?»", () => {
    const { tokens, plan } = p("brunnenwge 2 tlf")
    expect(plan).toMatchObject({ kind: "blocked", reason: "ambiguous" })
    expect(tokens[0]).toMatchObject({ confirm: "typo", choices: [{ kind: "incident" }] })
  })

  it("one Einsatz per line: a second one is greyed, the number wins", () => {
    const { tokens, plan } = p("14 rosenweg 9 tlf")
    expect(dispatchOf(plan).incident.id).toBe("inc-14")
    expect(tokens[1].state).toBe("ignored")
  })
})

describe("parseDispatch — vehicles and Geräte", () => {
  it("matches a vehicle by name, compact name, type or call sign", () => {
    expect(parse("pio").plan).toMatchObject({ kind: "jump", target: { id: "v-pio" } })
    expect(parse("mtw 2").plan).toMatchObject({ kind: "jump", target: { id: "v-mtw2" } })
    expect(parse("mtw2").plan).toMatchObject({ kind: "jump", target: { id: "v-mtw2" } })
    expect(parse("omega").plan).toMatchObject({ kind: "jump", target: { id: "v-tlf" } })
  })

  it("asks which one when a type names several vehicles", () => {
    const { tokens, plan } = parse("14 mtw")
    expect(plan).toMatchObject({ kind: "blocked", reason: "ambiguous" })
    expect(tokens[1].choices).toHaveLength(2)
  })

  it("a number after a vehicle type belongs to the vehicle", () => {
    const plan = dispatchOf(parse("14 mtw 1 muster").plan)
    expect(plan.assign.map((entry) => entry.target.id)).toEqual(["v-mtw1", "p-muster"])
  })

  it("takes a free unit of an interchangeable Gerät", () => {
    const plan = dispatchOf(parse("14 tauchpumpe").plan)
    expect(plan.assign.map((entry) => entry.target.id)).toEqual(["m-pumpe-2"])
  })

  it("matches Geräte with diacritics and prefixes", () => {
    expect(dispatchOf(parse("14 motorsage").plan).assign[0].target.id).toBe("m-saege")
  })
})

describe("parseDispatch — the Einsatz", () => {
  it("an unknown number blocks everything", () => {
    expect(parse("99 tlf").plan).toEqual({ kind: "blocked", reason: "unknown-incident", number: 99 })
    expect(parse("99").plan).toEqual({ kind: "blocked", reason: "unknown-incident", number: 99 })
  })

  it("accepts the number after the resources when nothing else claims it", () => {
    const plan = dispatchOf(parse("tlf muster 14").plan)
    expect(plan.incident.id).toBe("inc-14")
    expect(plan.assign).toHaveLength(2)
  })

  it("a leading number is always the Einsatz, even «1»", () => {
    expect(parse("1 tlf").plan).toMatchObject({ kind: "dispatch", incident: { id: "inc-1" } })
  })

  it("asks for a number when there is more than one thing and no Einsatz", () => {
    expect(parse("tlf muster").plan).toEqual({ kind: "blocked", reason: "needs-incident" })
    expect(parse("einsatz").plan).toEqual({ kind: "blocked", reason: "needs-incident" })
    expect(parse("hoch").plan).toEqual({ kind: "blocked", reason: "needs-incident" })
  })

  it("treats two Einsätze with one number as ambiguous, not as a guess", () => {
    const doubled: DispatchVocabulary = {
      ...vocabulary,
      incidents: [...vocabulary.incidents, { id: "inc-14b", number: 14, label: "Dorf", status: "incoming", priority: "low" }],
    }
    expect(parseDispatch("14 tlf", doubled).plan).toMatchObject({ kind: "blocked", reason: "ambiguous" })
  })
})

describe("parseDispatch — what the preview shows", () => {
  it("greys unknown tokens and still plans the rest", () => {
    const { tokens, plan } = parse("14 tlf xyzzy")
    expect(tokens.map((token) => token.state)).toEqual(["incident", "match", "unknown"])
    expect(dispatchOf(plan).assign).toHaveLength(1)
  })

  it("an Einsatz with only unknown words still just opens", () => {
    expect(parse("14 xyzzy").plan).toMatchObject({ kind: "open" })
  })

  it("keeps offsets into the input for every token", () => {
    const { tokens } = parse("14  meier hans tlf")
    expect(tokens.map((token) => [token.text, token.start, token.end])).toEqual([
      ["14", 0, 2],
      ["meier hans", 4, 14],
      ["tlf", 15, 18],
    ])
  })

  it("marks resources already on this Einsatz and names the others they are on", () => {
    const plan = dispatchOf(parse("14 schneider meier hans").plan)
    expect(plan.assign).toEqual([
      expect.objectContaining({ target: expect.objectContaining({ id: "p-schneider" }), alreadyHere: true, elsewhere: [] }),
      expect.objectContaining({ target: expect.objectContaining({ id: "p-meier-hans" }), alreadyHere: false, elsewhere: [12] }),
    ])
  })

  it("is a no-op when everything is already so", () => {
    expect(dispatchOf(parse("14 schneider").plan).noop).toBe(true)
    // Einsatz 12 is already «Im Einsatz» and «Hoch».
    const plan = dispatchOf(parse("12 einsatz hoch").plan)
    expect(plan).toMatchObject({ status: null, priority: null, noop: true })
  })

  it("names a resource once, and only the last status word counts", () => {
    const { tokens, plan } = parse("14 tlf tlf reko einsatz")
    expect(dispatchOf(plan).assign).toHaveLength(1)
    expect(dispatchOf(plan).status).toBe("active")
    expect(tokens.map((token) => token.state)).toEqual(["incident", "match", "ignored", "ignored", "match"])
  })

  it("plans nothing for text it does not know — the palette list takes over", () => {
    expect(parse("").plan).toEqual({ kind: "none" })
    expect(parse("   ").plan).toEqual({ kind: "none" })
    expect(parse("xyzzy").plan).toEqual({ kind: "none" })
  })
})

describe("status vocabulary covers both catalogues", () => {
  // The column names an operator reads are the words they will type. A renamed
  // column that the parser does not know would be a silent regression.
  for (const [locale, messages] of [["de", de], ["fr", fr]] as const) {
    for (const [status, label] of Object.entries(messages.kanban.columns)) {
      it(`${locale}: «${label}» → ${status}`, () => {
        const { tokens } = parse(`1 ${label.replace(/\//g, " ")}`)
        const counted = tokens.filter((token) => token.state === "match")
        expect(counted).toHaveLength(1)
        expect(counted[0].target).toEqual({ kind: "status", status })
      })
    }
  }
})

describe("completeDispatch — ⇥", () => {
  const complete = (input: string, vocab: DispatchVocabulary = vocabulary) =>
    completeDispatch(input, vocab).map((completion) => completion.text)

  it("completes a person after the Einsatz number, and the line parses to them", () => {
    expect(complete("14 must")).toEqual(["14 Muster Peter "])
    const plan = dispatchOf(parse("14 Muster Peter ").plan)
    expect(plan.assign.map((entry) => entry.target.id)).toEqual(["p-muster"])
  })

  it("offers every candidate for an ambiguous beginning, for ⇥ to step through", () => {
    expect(complete("14 meier")).toEqual(["14 Meier Anna ", "14 Meier Hans "])
    // A name already begun: the last word may be a single letter.
    expect(complete("14 meier h")).toEqual(["14 Meier Hans "])
  })

  it("completes the Einsatz by its address while the line has none", () => {
    const vocab: DispatchVocabulary = {
      ...vocabulary,
      incidents: [
        ...vocabulary.incidents,
        { id: "inc-20", number: 20, label: "Grenzweg 1, BLT Tramdepot", status: "incoming", priority: "low" },
      ],
    }
    expect(complete("grenz", vocab)).toEqual(["Grenzweg 1 "])
    const parsed = parseDispatch("Grenzweg 1 must", vocab)
    expect(dispatchOf(parsed.plan).incident.id).toBe("inc-20")
    // With an Einsatz already named, no second one is offered.
    expect(complete("14 grenz", vocab)).toEqual([])
  })

  it("completes vehicles and Geräte, interchangeable units once", () => {
    expect(complete("14 omeg")).toEqual(["14 Omega 1 "])
    expect(complete("14 tauch")).toEqual(["14 Tauchpumpe "])
  })

  it("puts the board's own words last", () => {
    expect(complete("14 dispo")).toEqual(["14 disponiert "])
    expect(complete("14 m").length).toBe(0) // one letter alone is too little
  })

  it("does nothing after a space, on a number, or on a word typed in full", () => {
    expect(complete("14 must ")).toEqual([])
    expect(complete("14")).toEqual([])
    expect(complete("14 Muster Peter")).toEqual([])
    expect(complete("14 xyzq")).toEqual([])
  })
})
