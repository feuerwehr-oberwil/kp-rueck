import { describe, expect, it } from "vitest";
import { materialFormDefaults, materialFormSchema } from "./material";

describe("materialFormSchema", () => {
  it("accepts a fully populated valid material", () => {
    const result = materialFormSchema.safeParse({
      name: "Tauchpumpe Gr.",
      type: "Pumpe",
      status: "available",
      location: "TLF",
      consumable: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a consumable material with empty type/location", () => {
    const result = materialFormSchema.safeParse({
      name: "Flatterband",
      type: "",
      status: "available",
      location: "",
      consumable: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = materialFormSchema.safeParse({
      ...materialFormDefaults,
      name: "   ",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["name"]);
    }
  });

  it("rejects a non-boolean consumable", () => {
    const result = materialFormSchema.safeParse({
      ...materialFormDefaults,
      name: "Tauchpumpe",
      consumable: "yes",
    });
    expect(result.success).toBe(false);
  });
});
