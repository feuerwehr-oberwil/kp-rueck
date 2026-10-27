import { z } from "zod";
import { translateOutsideReact } from "@/lib/i18n-messages";

const personnelStatusSchema = z.enum([
  "available",
  "unavailable",
]);

// The limits are the API's (backend/app/schemas/personnel.py), which refuses longer with a 422.
export const personnelFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, translateOutsideReact("settings.validation.nameRequired"))
    .max(100, translateOutsideReact("settings.validation.max100")),
  /** Tells two people of the same name apart; blank = none. */
  kennung: z.string().trim().max(20, translateOutsideReact("settings.validation.max20")).optional().default(""),
  role: z
    .string()
    .trim()
    .min(1, translateOutsideReact("settings.validation.roleRequired"))
    .max(50, translateOutsideReact("settings.validation.max50")),
  status: personnelStatusSchema,
  tags: z.array(z.string().trim().min(1).max(40)),
});

export type PersonnelFormValues = z.input<typeof personnelFormSchema>;

export const personnelFormDefaults: PersonnelFormValues = {
  name: "",
  kennung: "",
  role: "",
  status: "available",
  tags: [],
};
