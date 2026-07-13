"""Divera247 member sync service.

Fetches member names from Divera API and compares them with existing personnel
to produce a sync preview and execute synchronization.
"""

import logging
import unicodedata

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

# Same base as every other Divera call (app.divera247.com serves pull/ too) —
# configured centrally via DIVERA_API_URL instead of a second hardcoded host.
DIVERA_PULL_BASE_URL = settings.divera_api_url


def _normalize_name(name: str) -> str:
    """Normalize a name for comparison (lowercase, strip accents, collapse whitespace)."""
    name = " ".join(name.split()).strip().lower()
    # Normalize unicode (NFD decomposition), strip combining chars
    name = unicodedata.normalize("NFD", name)
    name = "".join(c for c in name if unicodedata.category(c) != "Mn")
    return name


def _format_name(stdformat_name: str, firstname: str, lastname: str) -> str | None:
    """Build display name from Divera fields.

    Returns "Lastname Firstname" for easy searching by last name.
    stdformat_name from Divera is "Lastname, Firstname".
    """
    if stdformat_name:
        parts = stdformat_name.split(",", 1)
        if len(parts) == 2:
            return f"{parts[0].strip()} {parts[1].strip()}"
        return stdformat_name.strip()
    if firstname and lastname:
        return f"{lastname} {firstname}"
    if lastname:
        return lastname
    return None


async def fetch_divera_members() -> list[dict]:
    """Fetch member names from Divera pull API.

    Returns list of dicts with keys: divera_id, name
    """
    if not settings.divera_access_key:
        raise ValueError("Divera access key not configured")

    url = f"{DIVERA_PULL_BASE_URL}/pull/all"
    params = {"accesskey": settings.divera_access_key}

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        data = response.json()

    if not data.get("success"):
        raise ValueError("Divera API returned success=false")

    cluster_data = data.get("data", {}).get("cluster", {})
    consumer_data = cluster_data.get("consumer", {})
    members = []

    for member_id_str, member_info in consumer_data.items():
        if not isinstance(member_info, dict):
            continue

        try:
            divera_id = int(member_id_str)
        except (ValueError, TypeError):
            continue

        # Build name
        firstname = (member_info.get("firstname") or "").strip()
        lastname = (member_info.get("lastname") or "").strip()
        stdformat_name = (member_info.get("stdformat_name") or "").strip()

        name = _format_name(stdformat_name, firstname, lastname)
        if not name:
            continue  # Skip members without a name

        members.append({
            "divera_id": divera_id,
            "name": name,
        })

    logger.info(f"Fetched {len(members)} members from Divera")
    return members


def build_sync_preview(divera_members: list[dict], existing_personnel: list) -> dict:
    """Compare Divera member names with existing personnel.

    Returns dict with keys: new, unchanged, not_in_divera
    """
    # Build lookup by normalized name for existing personnel
    existing_by_name: dict[str, list] = {}
    for person in existing_personnel:
        key = _normalize_name(person.name)
        existing_by_name.setdefault(key, []).append(person)

    matched_existing_ids = set()
    new_items = []
    unchanged_items = []

    for member in divera_members:
        key = _normalize_name(member["name"])
        matches = existing_by_name.get(key, [])

        if not matches:
            new_items.append({
                "member": member,
                "status": "new",
                "existing_id": None,
            })
        else:
            # Match to first unmatched existing person with same name
            matched_person = None
            for person in matches:
                if person.id not in matched_existing_ids:
                    matched_person = person
                    break
            if not matched_person:
                matched_person = matches[0]

            matched_existing_ids.add(matched_person.id)
            unchanged_items.append({
                "member": member,
                "status": "unchanged",
                "existing_id": str(matched_person.id),
                # Whether this person already has the Divera id stored locally.
                # False here means execute_sync will backfill it.
                "divera_linked": getattr(matched_person, "divera_user_id", None) is not None,
            })

    # Find personnel not in Divera
    not_in_divera = []
    for person in existing_personnel:
        if person.id not in matched_existing_ids:
            not_in_divera.append({
                "member": {
                    "divera_id": 0,
                    "name": person.name,
                },
                "status": "not_in_divera",
                "existing_id": str(person.id),
            })

    return {
        "new": new_items,
        "unchanged": unchanged_items,
        "not_in_divera": not_in_divera,
    }


async def execute_sync(db, preview: dict, remove_stale: bool, current_user, request) -> dict:
    """Execute the sync based on preview data.

    Creates new personnel and optionally deletes stale ones.

    Returns dict with created, deleted, unchanged counts.
    """
    from uuid import UUID

    from .. import schemas
    from ..crud import personnel as personnel_crud

    created = 0
    deleted = 0
    linked = 0  # existing people backfilled with their Divera id

    # Create new personnel, storing the Divera user_cluster_relation id so they
    # can be targeted directly by outbound alarms.
    for item in preview["new"]:
        member = item["member"]
        personnel_data = schemas.PersonnelCreate(
            name=member["name"],
            availability="available",
        )
        person = await personnel_crud.create_personnel(db, personnel_data, current_user, request)
        divera_id = member.get("divera_id")
        if divera_id:
            person.divera_user_id = divera_id
            await db.commit()
            linked += 1

    # Backfill the Divera id on existing matches that don't have it yet. The id
    # is what makes a person addressable for outbound alarms.
    for item in preview["unchanged"]:
        divera_id = item["member"].get("divera_id")
        existing_id = item.get("existing_id")
        if not divera_id or not existing_id:
            continue
        person = await personnel_crud.get_personnel(db, UUID(existing_id))
        if person is not None and person.divera_user_id != divera_id:
            person.divera_user_id = divera_id
            await db.commit()
            linked += 1

    # Delete stale personnel
    if remove_stale:
        for item in preview["not_in_divera"]:
            existing_id = item["existing_id"]
            await personnel_crud.delete_personnel(db, existing_id, current_user, request)
            deleted += 1

    return {
        "created": created,
        "deleted": deleted,
        "linked": linked,
        "unchanged": len(preview["unchanged"]),
    }
