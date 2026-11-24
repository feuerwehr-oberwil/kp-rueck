import { describe, expect, it } from "vitest";
import { vehicleFormDefaults, vehicleFormSchema, vehicleTypeFor, vehicleUpdateFor } from "./vehicle";

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
      status: "maintenance",
    });
    expect(result.success).toBe(false);
  });

  it("sends a type the API accepts: the form's, or the name cut to 50 characters", () => {
    expect(vehicleTypeFor({ name: "TLF 1", type: "TLF" })).toBe("TLF");
    expect(vehicleTypeFor({ name: "TLF 1", type: "  " })).toBe("TLF 1");
    expect(vehicleTypeFor({ name: "x".repeat(80), type: "" })).toHaveLength(50);
  });
});

describe("vehicleUpdateFor", () => {
  const opened = {
    name: "TLF 1",
    type: "TLF",
    display_order: 1,
    status: "available" as const,
    radio_call_sign: "Omega 1",
  };

  it("sends only the call sign when only the call sign changed – readiness stays another desk's", () => {
    expect(vehicleUpdateFor(opened, { ...opened, radio_call_sign: "Omega 2" })).toEqual({ radio_call_sign: "Omega 2" });
  });

  it("sends nothing when nothing changed", () => {
    expect(vehicleUpdateFor(opened, { ...opened })).toEqual({});
  });

  it("never sends a type – the dialog has no field for it", () => {
    expect(vehicleUpdateFor({ ...opened, type: "" }, { ...opened, type: "", name: "TLF 2" })).toEqual({ name: "TLF 2" });
  });

  it("sends the readiness when it was changed here", () => {
    expect(vehicleUpdateFor(opened, { ...opened, status: "unavailable" })).toEqual({ status: "unavailable" });
  });
});
