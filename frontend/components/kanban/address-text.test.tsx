import { describe, expect, it } from "vitest"

import { houseNumberParts } from "./address-text"

describe("houseNumberParts", () => {
  it("binds each house number to the space before it", () => {
    expect(houseNumberParts("Kirchgasse 3")).toEqual(["Kirchgasse", " 3", ""])
    expect(houseNumberParts("Hauptstr. 40a")).toEqual(["Hauptstr.", " 40a", ""])
  })

  it("leaves the break after a comma and text without a number alone", () => {
    expect(houseNumberParts("Langegasse 28, 4104 Oberwil")).toEqual(["Langegasse", " 28", ", 4104 Oberwil"])
    expect(houseNumberParts("Sturmholz Oberwil")).toEqual(["Sturmholz Oberwil"])
  })
})
