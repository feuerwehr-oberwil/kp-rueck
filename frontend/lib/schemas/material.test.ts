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

  it("requires type and location, as the API does (it 422s a blank one)", () => {
    const result = materialFormSchema.safeParse({
      name: "Flatterband",
      type: "",
      status: "available",
      location: "",
      consumable: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(["type", "location"]);
    }
  });

  it("caps name at 100 and type at 50 characters, the column lengths", () => {
    const valid = { name: "Tauchpumpe", type: "Pumpe", status: "available", location: "TLF", consumable: false };
    expect(materialFormSchema.safeParse({ ...valid, name: "x".repeat(100) }).success).toBe(true);
    expect(materialFormSchema.safeParse({ ...valid, name: "x".repeat(101) }).success).toBe(false);
    expect(materialFormSchema.safeParse({ ...valid, type: "x".repeat(51) }).success).toBe(false);
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
