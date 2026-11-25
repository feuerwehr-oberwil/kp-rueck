import { z } from "zod";
import { translateOutsideReact } from "@/lib/i18n-messages";
import type { ApiPersonnel, ApiPersonnelUpdate } from "@/lib/api-client";

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

/** What the edit dialog opens with for `person`. */
export function personnelFormValuesFor(
  person: Pick<ApiPersonnel, "name" | "kennung" | "role" | "status" | "tags">,
): PersonnelFormValues {
  return {
    name: person.name,
    kennung: person.kennung ?? "",
    role: person.role || "",
    status: person.status === "available" || person.status === "unavailable" ? person.status : "available",
    tags: person.tags || [],
  };
}

/**
 * The update an edit sends: only the fields that differ from what the dialog opened with.
 * An untouched field – the status above all – must not overwrite what another desk set while
 * the dialog was open (hunt follow-up 25.11., as `vehicleUpdateFor`). Empty = nothing to send.
 */
export function personnelUpdateFor(opened: PersonnelFormValues, values: PersonnelFormValues): ApiPersonnelUpdate {
  const update: ApiPersonnelUpdate = {};
  if (values.name !== opened.name) update.name = values.name;
  if ((values.kennung ?? "") !== (opened.kennung ?? "")) update.kennung = values.kennung;
  if (values.role !== opened.role) update.role = values.role;
  if (values.status !== opened.status) update.status = values.status;
  // Trimmed on both sides: the form trims, a stored tag may not be.
  const tagsOf = (form: PersonnelFormValues) => form.tags.map((tag) => tag.trim()).join("\n");
  if (tagsOf(values) !== tagsOf(opened)) update.tags = values.tags;
  return update;
}
