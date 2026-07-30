"""Server-side display labels for incident locations.

The frontend used to strip the home city from addresses client-side, but the
home_city setting loads asynchronously there — first paint showed the full
address, a later render the short one. Computing the label here means clients
render the final string immediately.
"""

from collections.abc import Iterable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from .. import schemas
from .pdf_report_service import format_location_for_display
from .settings import get_setting_value


async def get_home_city(db: AsyncSession) -> str:
    return await get_setting_value(db, "home_city", "") or ""


def with_location_display(incident: Any, home_city: str) -> schemas.IncidentResponse:
    """Validate to IncidentResponse and fill the location_display label."""
    response = (
        incident
        if isinstance(incident, schemas.IncidentResponse)
        else schemas.IncidentResponse.model_validate(incident)
    )
    response.location_display = (
        format_location_for_display(response.location_address, home_city) if response.location_address else None
    )
    return response


async def incident_with_display(db: AsyncSession, incident: Any) -> schemas.IncidentResponse:
    return with_location_display(incident, await get_home_city(db))


async def incidents_with_display(db: AsyncSession, incidents: Iterable[Any]) -> list[schemas.IncidentResponse]:
    home_city = await get_home_city(db)
    return [with_location_display(incident, home_city) for incident in incidents]
