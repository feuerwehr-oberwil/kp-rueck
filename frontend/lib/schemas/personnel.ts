import { z } from "zod";
import { translateOutsideReact } from "@/lib/i18n-messages";

export const personnelStatusSchema = z.enum([
  "available",
  "unavailable",
]);

export const personnelFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, translateOutsideReact("settings.validation.nameRequired"))
    .max(120, translateOutsideReact("settings.validation.max120")),
  role: z
    .string()
    .trim()
    .min(1, translateOutsideReact("settings.validation.roleRequired"))
    .max(80, translateOutsideReact("settings.validation.max80")),
  status: personnelStatusSchema,
  tags: z.array(z.string().trim().min(1).max(40)),
});

export type PersonnelFormValues = z.input<typeof personnelFormSchema>;

export const personnelFormDefaults: PersonnelFormValues = {
  name: "",
  role: "",
  status: "available",
  tags: [],
};
