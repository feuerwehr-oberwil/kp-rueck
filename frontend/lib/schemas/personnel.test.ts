import { describe, expect, it } from "vitest";
import {
  personnelFormDefaults,
  personnelFormSchema,
} from "./personnel";

describe("personnelFormSchema", () => {
  it("accepts a minimal valid personnel record", () => {
    const result = personnelFormSchema.safeParse({
      name: "Müller Stefan",
      role: "Offizier",
      status: "available",
      tags: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts personnel with tags", () => {
    const result = personnelFormSchema.safeParse({
      name: "Müller Stefan",
      role: "Offizier",
      status: "available",
      tags: ["Atemschutz", "Maschinist"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = personnelFormSchema.safeParse({
      ...personnelFormDefaults,
      name: "   ",
      role: "Offizier",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["name"]);
    }
  });

  it("rejects an empty role", () => {
    const result = personnelFormSchema.safeParse({
      ...personnelFormDefaults,
      name: "Müller Stefan",
      role: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["role"]);
    }
  });

  it("rejects unknown status values", () => {
    const result = personnelFormSchema.safeParse({
      ...personnelFormDefaults,
      name: "Müller Stefan",
      role: "Offizier",
      status: "checked_in",
    });
    expect(result.success).toBe(false);
  });

  it("caps name at 100, role at 50 and the Kennung at 20 characters, as the API does", () => {
    const valid = { name: "Meier Alex", kennung: "1985", role: "Soldat", status: "available", tags: [] };
    expect(personnelFormSchema.safeParse(valid).success).toBe(true);
    expect(personnelFormSchema.safeParse({ ...valid, name: "x".repeat(101) }).success).toBe(false);
    expect(personnelFormSchema.safeParse({ ...valid, role: "x".repeat(51) }).success).toBe(false);
    expect(personnelFormSchema.safeParse({ ...valid, kennung: "x".repeat(21) }).success).toBe(false);
  });
});
