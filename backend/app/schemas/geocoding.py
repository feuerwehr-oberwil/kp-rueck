"""Provider-independent address suggestions and bounded search inputs."""

import math
import re

from pydantic import BaseModel, Field, field_validator


class AddressSearch(BaseModel):
    q: str = Field(min_length=3, max_length=200)
    countrycodes: str = Field(default="ch", max_length=60)
    viewbox: str | None = Field(default=None, max_length=100)

    @field_validator("q")
    @classmethod
    def normalize_query(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 3 or len(value.split()) > 10:
            raise ValueError("Use at least three characters and at most ten words")
        return value

    @field_validator("countrycodes")
    @classmethod
    def normalize_countries(cls, value: str) -> str:
        value = value.lower().strip()
        if value and not re.fullmatch(r"[a-z]{2}(,[a-z]{2})*", value):
            raise ValueError("Expected comma-separated two-letter country codes")
        return ",".join(sorted(set(value.split(","))))

    @field_validator("viewbox")
    @classmethod
    def validate_viewbox(cls, value: str | None) -> str | None:
        if value is None:
            return None
        coordinates = [float(part) for part in value.split(",")]
        if len(coordinates) != 4 or not all(math.isfinite(n) for n in coordinates):
            raise ValueError("Expected four finite viewbox coordinates")
        west, south, east, north = coordinates
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError("Invalid viewbox extent")
        return ",".join(str(n) for n in coordinates)


class AddressReverse(BaseModel):
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)


class AddressSuggestion(BaseModel):
    id: str
    display_name: str
    lat: float
    lon: float
    formattedAddress: str  # noqa: N815 – preserves the existing frontend contract
    attribution: str


class ReversedAddress(BaseModel):
    address: str | None = None
