import { z } from "zod";

export const materialStatusSchema = z.enum(["available", "unavailable"]);

export const materialFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name ist erforderlich")
    .max(120, "Maximal 120 Zeichen"),
  type: z.string().trim().max(80, "Maximal 80 Zeichen"),
  status: materialStatusSchema,
  location: z.string().trim().max(80, "Maximal 80 Zeichen"),
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
