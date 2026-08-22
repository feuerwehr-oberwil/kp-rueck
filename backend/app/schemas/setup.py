"""First-run setup wizard schemas (claiming an unclaimed board)."""

from pydantic import BaseModel, Field, field_validator


class SetupStatusResponse(BaseModel):
    """Whether this board has been claimed (= at least one user account exists)."""

    claimed: bool


class SetupClaimRequest(BaseModel):
    """The claim: a station name and the admin password the claimer chose.

    The password minimum mirrors the seed's ADMIN_SEED_PASSWORD validation
    (auth.config.MIN_PASSWORD_LENGTH = 12) — the browser path must not accept
    a password the env-var path would refuse. The station name cap matches the
    order of magnitude of other identity fields (User.display_name is 100);
    the value lands in the `firestation_name` setting and on every printout.
    """

    station_name: str = Field(min_length=1, max_length=120)
    admin_password: str = Field(min_length=12, max_length=128)

    @field_validator("station_name")
    @classmethod
    def _station_name_not_blank(cls, value: str) -> str:
        """Trim, and refuse names that were only whitespace (422 via the schema)."""
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("station_name must not be blank")
        return trimmed


class SetupClaimResponse(BaseModel):
    """The login the frontend signs in with right after a successful claim."""

    username: str
