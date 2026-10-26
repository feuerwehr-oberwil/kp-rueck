import { z } from "zod";
import { translateOutsideReact } from "@/lib/i18n-messages";

const vehicleStatusSchema = z.enum(["available", "unavailable"]);

// The limits are the API's (backend/app/schemas/vehicles.py), which refuses longer with a 422.
export const vehicleFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, translateOutsideReact("settings.validation.nameRequired"))
    .max(100, translateOutsideReact("settings.validation.max100")),
  /** Required by the API; the form has no field for it and sends the name
   *  (cut to the column) when it is blank — see `vehicleTypeFor`. */
  type: z.string().trim().max(50, translateOutsideReact("settings.validation.max50")).optional().default(""),
  display_order: z
    .number({ message: translateOutsideReact("settings.validation.orderNumber") })
    .int(translateOutsideReact("settings.validation.orderInt"))
    .min(1, translateOutsideReact("settings.validation.orderMin1")),
  status: vehicleStatusSchema,
  radio_call_sign: z
    .string()
    .trim()
    .min(1, translateOutsideReact("settings.validation.callsignRequired"))
    .max(40, translateOutsideReact("settings.validation.max40")),
});

export type VehicleFormValues = z.input<typeof vehicleFormSchema>;

/** The vehicle type the API gets: the form's, or the name cut to the 50-char column. */
export function vehicleTypeFor(values: Pick<VehicleFormValues, "name" | "type">): string {
  return values.type?.trim() || values.name.trim().slice(0, 50);
}

export const vehicleFormDefaults: VehicleFormValues = {
  name: "",
  type: "",
  display_order: 1,
  status: "available",
  radio_call_sign: "",
};
