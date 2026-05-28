import { describe, expect, it } from "vitest";
import { vehicleFormDefaults, vehicleFormSchema } from "./vehicle";

describe("vehicleFormSchema", () => {
  it("accepts a fully populated valid vehicle", () => {
    const result = vehicleFormSchema.safeParse({
      name: "TLF 1",
      type: "TLF",
      display_order: 1,
      status: "available",
      radio_call_sign: "Omega 1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = vehicleFormSchema.safeParse({
      ...vehicleFormDefaults,
      name: "   ",
      radio_call_sign: "Omega 1",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["name"]);
    }
  });

  it("rejects a missing radio_call_sign", () => {
    const result = vehicleFormSchema.safeParse({
      ...vehicleFormDefaults,
      name: "TLF 1",
      radio_call_sign: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["radio_call_sign"]);
    }
  });

  it("rejects display_order < 1", () => {
    const result = vehicleFormSchema.safeParse({
      ...vehicleFormDefaults,
      name: "TLF 1",
      radio_call_sign: "Omega 1",
      display_order: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["display_order"]);
    }
  });

  it("rejects a non-integer display_order", () => {
    const result = vehicleFormSchema.safeParse({
      ...vehicleFormDefaults,
      name: "TLF 1",
      radio_call_sign: "Omega 1",
      display_order: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a NaN display_order (empty number input)", () => {
    const result = vehicleFormSchema.safeParse({
      ...vehicleFormDefaults,
      name: "TLF 1",
      radio_call_sign: "Omega 1",
      display_order: Number.NaN,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown status", () => {
    const result = vehicleFormSchema.safeParse({
      ...vehicleFormDefaults,
      name: "TLF 1",
      radio_call_sign: "Omega 1",
      // @ts-expect-error – deliberately wrong status value
      status: "maintenance",
    });
    expect(result.success).toBe(false);
  });
});
