/**
 * The board had no keyboard route to a card at all: `selectedOperationId` —
 * which every key that CHANGES something acts on — could only be set by a
 * click or a drop. These pin the arrow-key walk that opened it up.
 */

import { describe, expect, it } from "vitest"

import { directionFromKey, nextCardId } from "./board-keyboard-nav"

/** A board as the DOM renders it: one `[data-column]` per column, cards inside. */
function board(columns: string[][]): HTMLElement {
  const root = document.createElement("div")
  for (const ids of columns) {
    const column = document.createElement("div")
    column.setAttribute("data-column", "")
    for (const id of ids) {
      const card = document.createElement("div")
      card.setAttribute("data-incident-id", id)
      column.appendChild(card)
    }
    root.appendChild(column)
  }
  return root
}

describe("nextCardId", () => {
  it("walks down and up inside a column, and stops at its ends", () => {
    const root = board([["a", "b", "c"]])
    expect(nextCardId("a", "down", root)).toBe("b")
    expect(nextCardId("b", "down", root)).toBe("c")
    expect(nextCardId("c", "down", root)).toBeNull()
    expect(nextCardId("c", "up", root)).toBe("b")
    expect(nextCardId("a", "up", root)).toBeNull()
  })

  it("keeps the vertical position when stepping sideways", () => {
    const root = board([["a1", "a2", "a3"], ["b1", "b2", "b3"]])
    expect(nextCardId("a2", "right", root)).toBe("b2")
    expect(nextCardId("b3", "left", root)).toBe("a3")
  })

  it("lands on the last card when the next column is shorter", () => {
    const root = board([["a1", "a2", "a3"], ["b1"]])
    expect(nextCardId("a3", "right", root)).toBe("b1")
  })

  // A folded column renders no cards, so this is also how arrows skip one.
  it("steps over empty columns instead of stopping at them", () => {
    const root = board([["a"], [], [], ["d"]])
    expect(nextCardId("a", "right", root)).toBe("d")
    expect(nextCardId("d", "left", root)).toBe("a")
  })

  it("stops at the edges of the board", () => {
    const root = board([["a"], ["b"]])
    expect(nextCardId("a", "left", root)).toBeNull()
    expect(nextCardId("b", "right", root)).toBeNull()
  })

  // The way in from cold: nothing selected, any arrow key picks a starting card.
  it("starts at the first card when nothing is selected", () => {
    const root = board([[], ["b1", "b2"]])
    expect(nextCardId(null, "down", root)).toBe("b1")
    expect(nextCardId(null, "left", root)).toBe("b1")
  })

  it("treats a selection that is no longer rendered as no selection", () => {
    const root = board([["a"]])
    expect(nextCardId("filtered-away", "down", root)).toBe("a")
  })

  it("has nowhere to go on an empty board", () => {
    expect(nextCardId(null, "down", board([[], []]))).toBeNull()
  })
})

describe("directionFromKey", () => {
  it("maps the four arrows and nothing else", () => {
    expect(directionFromKey("ArrowUp")).toBe("up")
    expect(directionFromKey("ArrowDown")).toBe("down")
    expect(directionFromKey("ArrowLeft")).toBe("left")
    expect(directionFromKey("ArrowRight")).toBe("right")
    expect(directionFromKey("Enter")).toBeNull()
    expect(directionFromKey("j")).toBeNull()
  })
})
