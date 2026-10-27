import { z } from "zod";
import { translateOutsideReact } from "@/lib/i18n-messages";

const materialStatusSchema = z.enum(["available", "unavailable"]);

// The limits are the API's (backend/app/schemas/materials.py), which refuses longer — or a
// blank type or location — with a 422.
export const materialFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, translateOutsideReact("settings.validation.nameRequired"))
    .max(100, translateOutsideReact("settings.validation.max100")),
  type: z
    .string()
    .trim()
    .min(1, translateOutsideReact("settings.validation.typeRequired"))
    .max(50, translateOutsideReact("settings.validation.max50")),
  status: materialStatusSchema,
  location: z
    .string()
    .trim()
    .min(1, translateOutsideReact("settings.validation.locationRequired"))
    .max(100, translateOutsideReact("settings.validation.max100")),
  consumable: z.boolean(),
});

export type MaterialFormValues = z.input<typeof materialFormSchema>;

export const materialFormDefaults: MaterialFormValues = {
  name: "",
  type: "",
  status: "available",
  location: "",
  consumable: false,
};
