"""CRUD for the `/feld` field surface (plan 25).

Two things live here, and the second one is the load-bearing part:

1. The read queries behind the person picker and "meine Einsatzstellen".
2. **Step 2 of the `/feld` authorization.** The event token (step 1) only says
   *which Ereignis*; it never says *who*. Visibility is "only mine" (decision 4)
   and it is enforced here, server-side, never in the UI: a person sees exactly
   the incidents they are — or **were** — assigned to. Released rows count on
   purpose, because a crew files the rapport *after* being released; requiring
   ``unassigned_at IS NULL`` would lock out exactly the moment the form is for.

Every later phase of plan 25 mounts on ``person_has_event_assignment`` /
``get_authorized_incident``; adding an endpoint without one of them is the hole
this module exists to prevent.
"""

# Split from a single 2300-line module (plan 26, decision 21). The package
# re-exports every name the old module exposed, so `from ..crud import feld`
# and `crud.<anything>` keep working unchanged — including the underscore
# helpers the tests reach for.

from .material import (
    event_restliste,
    material_left_on_site_named,
    material_return_attribution,
    material_return_units,
)
from .rapport import (
    CONCURRENT_EDITOR_WINDOW,
    _board_material_units,
    _board_personnel_count,
    _build_cost_snapshot,
    _concurrent_editor,
    _event_personnel,
    _fleet_vehicles,
    _is_answered,
    _jsonable_materials,
    _jsonable_personnel,
    _jsonable_vehicles,
    _material_name_suggestions,
    _material_used,
    _names,
    _route_assigned_ids,
    add_photo,
    derive_personnel_count,
    get_rapport,
    normalize_extra_materials,
    normalize_extra_personnel,
    reconcile_materials,
    reconcile_personnel,
    reconcile_vehicles,
    remove_photo,
    save_rapport,
)
from .reports import (
    FieldActor,
    _broadcast,
    _get_or_create_report,
    _location,
    _stamp_updated_by,
    field_report_state,
    is_automation_user,
    record_arrival,
    record_field_complete,
    record_field_message,
    record_pickup,
)
from .visibility import (
    _DANGER_KEYS,
    _briefings,
    _event_incidents,
    _rapport_state,
    _rapport_states,
    _reko_briefings,
    get_authorized_incident,
    get_feld_assignments_for_personnel,
    get_feld_personnel_for_event,
    get_incident_leaders,
    person_has_event_assignment,
)

__all__ = [
    "CONCURRENT_EDITOR_WINDOW",
    "_DANGER_KEYS",
    "FieldActor",
    "_board_material_units",
    "_board_personnel_count",
    "_briefings",
    "_broadcast",
    "_build_cost_snapshot",
    "_concurrent_editor",
    "_event_incidents",
    "_event_personnel",
    "_fleet_vehicles",
    "_get_or_create_report",
    "_is_answered",
    "_jsonable_materials",
    "_jsonable_personnel",
    "_jsonable_vehicles",
    "_location",
    "_material_name_suggestions",
    "_material_used",
    "_names",
    "_rapport_state",
    "_rapport_states",
    "_reko_briefings",
    "_route_assigned_ids",
    "_stamp_updated_by",
    "add_photo",
    "derive_personnel_count",
    "event_restliste",
    "field_report_state",
    "get_authorized_incident",
    "get_feld_assignments_for_personnel",
    "get_feld_personnel_for_event",
    "get_incident_leaders",
    "get_rapport",
    "is_automation_user",
    "material_left_on_site_named",
    "material_return_attribution",
    "material_return_units",
    "normalize_extra_materials",
    "normalize_extra_personnel",
    "person_has_event_assignment",
    "reconcile_materials",
    "reconcile_personnel",
    "reconcile_vehicles",
    "record_arrival",
    "record_field_complete",
    "record_field_message",
    "record_pickup",
    "remove_photo",
    "save_rapport",
]
