"""Address lookup for authenticated board users and live, bound field devices."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.dependencies import get_current_user
from ..crud.feld import claim_is_live
from ..database import get_db
from ..middleware.rate_limit import RateLimits, limiter
from ..schemas.geocoding import AddressReverse, AddressSearch, AddressSuggestion, ReversedAddress
from ..services.geocoding import GeocodingBusyError, GeocodingUnavailableError, geocoder
from ..services.tokens import validate_feld_token

router = APIRouter(prefix="/geocoding", tags=["geocoding"])


async def require_geocoding_access(request: Request, db: AsyncSession = Depends(get_db)) -> None:
    field_token = request.headers.get("X-Feld-Token") or request.cookies.get("feld-device-token")
    if field_token:
        claims = validate_feld_token(field_token)
        if (
            claims is not None
            and claims.unlocked
            and claims.personnel_id is not None
            and claims.claim_id is not None
            and await claim_is_live(db, claims.claim_id, claims.event_id, claims.personnel_id)
        ):
            return
    # Explicitly omit Authorization: a shared integration/master secret is not a browser login.
    await get_current_user(request, access_token=request.cookies.get("access_token"), authorization=None, db=db)


@router.get("/search", response_model=list[AddressSuggestion], dependencies=[Depends(require_geocoding_access)])
@limiter.limit(RateLimits.FELD)
async def search_address(
    request: Request,
    query: Annotated[AddressSearch, Query()],
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> list[AddressSuggestion]:
    response.headers["Cache-Control"] = "no-store"
    try:
        return await geocoder.search(db, query)
    except GeocodingBusyError:
        raise HTTPException(
            429, "Adresssuche ist ausgelastet. Bitte kurz warten.", headers={"Retry-After": "2"}
        ) from None
    except GeocodingUnavailableError:
        raise HTTPException(503, "Adresssuche ist vorübergehend nicht verfügbar") from None


@router.get("/reverse", response_model=ReversedAddress, dependencies=[Depends(require_geocoding_access)])
@limiter.limit(RateLimits.FELD)
async def reverse_address(
    request: Request,
    point: Annotated[AddressReverse, Query()],
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> ReversedAddress:
    response.headers["Cache-Control"] = "no-store"
    try:
        return ReversedAddress(address=await geocoder.reverse(db, point))
    except GeocodingBusyError:
        raise HTTPException(
            429, "Adresssuche ist ausgelastet. Bitte kurz warten.", headers={"Retry-After": "2"}
        ) from None
    except GeocodingUnavailableError:
        raise HTTPException(503, "Adresssuche ist vorübergehend nicht verfügbar") from None
