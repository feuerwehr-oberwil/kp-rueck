import { z } from "zod";
import { translateOutsideReact } from "@/lib/i18n-messages";
import type { ApiVehicle, ApiVehicleUpdate } from "@/lib/api-client";

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

/** What the edit dialog opens with for `vehicle`. */
export function vehicleFormValuesFor(vehicle: ApiVehicle): VehicleFormValues {
  return {
    name: vehicle.name,
    type: vehicle.type,
    display_order: vehicle.display_order,
    status: vehicle.status === "available" || vehicle.status === "unavailable" ? vehicle.status : "available",
    radio_call_sign: vehicle.radio_call_sign,
  };
}

/**
 * The update an edit sends: only the fields that differ from what the dialog opened with.
 * An untouched field – readiness above all – must not overwrite what another desk set while
 * the dialog was open (hunt 2026-11-24). Empty = nothing to send.
 */
export function vehicleUpdateFor(opened: VehicleFormValues, values: VehicleFormValues): ApiVehicleUpdate {
  // No `type`: the form has no field for it – the name fallback (`vehicleTypeFor`) is for a create.
  const update: ApiVehicleUpdate = {};
  if (values.name !== opened.name) update.name = values.name;
  if (values.display_order !== opened.display_order) update.display_order = values.display_order;
  if (values.status !== opened.status) update.status = values.status;
  if (values.radio_call_sign !== opened.radio_call_sign) update.radio_call_sign = values.radio_call_sign;
  return update;
}
