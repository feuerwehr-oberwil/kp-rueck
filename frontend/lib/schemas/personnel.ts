import { z } from "zod";

export const personnelAvailabilitySchema = z.enum([
  "available",
  "unavailable",
]);

export const personnelFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name ist erforderlich")
    .max(120, "Maximal 120 Zeichen"),
  role: z
    .string()
    .trim()
    .min(1, "Rolle ist erforderlich")
    .max(80, "Maximal 80 Zeichen"),
  availability: personnelAvailabilitySchema,
  tags: z.array(z.string().trim().min(1).max(40)),
});

export type PersonnelFormValues = z.input<typeof personnelFormSchema>;
export type PersonnelFormOutput = z.output<typeof personnelFormSchema>;

export const personnelFormDefaults: PersonnelFormValues = {
  name: "",
  role: "",
  availability: "available",
  tags: [],
};
