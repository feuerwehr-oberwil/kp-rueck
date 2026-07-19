import { z } from "zod";
import { translateOutsideReact } from "@/lib/i18n-messages";

export const materialStatusSchema = z.enum(["available", "unavailable"]);

export const materialFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, translateOutsideReact("settings.validation.nameRequired"))
    .max(120, translateOutsideReact("settings.validation.max120")),
  type: z.string().trim().max(80, translateOutsideReact("settings.validation.max80")),
  status: materialStatusSchema,
  location: z.string().trim().max(80, translateOutsideReact("settings.validation.max80")),
  consumable: z.boolean(),
});

export type MaterialFormValues = z.input<typeof materialFormSchema>;
export type MaterialFormOutput = z.output<typeof materialFormSchema>;

export const materialFormDefaults: MaterialFormValues = {
  name: "",
  type: "",
  status: "available",
  location: "",
  consumable: false,
};
