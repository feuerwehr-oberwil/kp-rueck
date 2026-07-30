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
});
