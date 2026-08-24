import { z } from "zod";
import { translateOutsideReact } from "@/lib/i18n-messages";

export const vehicleStatusSchema = z.enum(["available", "unavailable"]);

export const vehicleFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, translateOutsideReact("settings.validation.nameRequired"))
    .max(80, translateOutsideReact("settings.validation.max80")),
  type: z.string().trim().max(80, translateOutsideReact("settings.validation.max80")).optional().default(""),
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

export const vehicleFormDefaults: VehicleFormValues = {
  name: "",
  type: "",
  display_order: 1,
  status: "available",
  radio_call_sign: "",
};
