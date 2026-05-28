import { z } from "zod";

export const vehicleStatusSchema = z.enum(["available", "unavailable"]);

export const vehicleFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name ist erforderlich")
    .max(80, "Maximal 80 Zeichen"),
  type: z.string().trim().max(80, "Maximal 80 Zeichen").optional().default(""),
  display_order: z
    .number({ message: "Reihenfolge muss eine Zahl sein" })
    .int("Reihenfolge muss eine ganze Zahl sein")
    .min(1, "Mindestens 1"),
  status: vehicleStatusSchema,
  radio_call_sign: z
    .string()
    .trim()
    .min(1, "Funkrufname ist erforderlich")
    .max(40, "Maximal 40 Zeichen"),
});

export type VehicleFormValues = z.input<typeof vehicleFormSchema>;
export type VehicleFormOutput = z.output<typeof vehicleFormSchema>;

export const vehicleFormDefaults: VehicleFormValues = {
  name: "",
  type: "",
  display_order: 1,
  status: "available",
  radio_call_sign: "",
};
