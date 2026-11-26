"""The sample station both fixtures show: one fleet and one roster.

The dev seed (`boot._seed_sample_resources`) and the demo seed
(`demo.seed_demo_shared_resources`) used to carry their own copies, which overlapped in five
vehicles and twenty people. Each person is listed here once, with the fixtures they appear
in; the order is each fixture's own insertion order (the dev operations pick people by
position, and the visual screenshots read the demo roster as it was).
"""

from datetime import datetime
from typing import Literal, NamedTuple, NotRequired, TypedDict
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from ..services.ranks import RANKS

Fixture = Literal["dev", "demo"]


class VehicleSeed(TypedDict):
    name: str
    type: str
    display_order: int
    radio_call_sign: str


STATION_VEHICLES: tuple[VehicleSeed, ...] = (
    {"name": "TLF", "type": "TLF", "display_order": 1, "radio_call_sign": "Omega 1"},
    {"name": "Pio", "type": "RW", "display_order": 2, "radio_call_sign": "Omega 2"},
    {"name": "Mowa", "type": "MTW", "display_order": 3, "radio_call_sign": "Omega 3"},
    {"name": "Trawa", "type": "MTW", "display_order": 4, "radio_call_sign": "Omega 4"},
    {"name": "Mawa", "type": "MTW", "display_order": 5, "radio_call_sign": "Omega 5"},
)


class MaterialSeed(TypedDict):
    """One material row of a fixture's catalogue (the two catalogues differ on purpose)."""

    name: str
    type: str
    location: str
    status: str
    consumable: NotRequired[bool]


class IncidentSeed(TypedDict):
    """A sample Einsatz as the fixtures write it; the seed adds ids, author and position."""

    title: str
    type: str
    priority: str
    location_address: str
    location_lat: float
    location_lng: float
    status: str
    description: str
    contact: NotRequired[str]
    contact_phone: NotRequired[str]
    created_at: NotRequired[datetime]
    completed_at: NotRequired[datetime]
    am_warten: NotRequired[bool]
    am_warten_note: NotRequired[str]
    zu_fuss: NotRequired[bool]


class StationPerson(NamedTuple):
    """One firefighter of the sample station; `dev` / `demo` say which fixture lists them."""

    name: str
    role: str
    tags: tuple[str, ...] = ()
    dev: bool = True
    demo: bool = True


# Common Swiss surnames, by Grad.
STATION_ROSTER: tuple[StationPerson, ...] = (
    # Offiziere
    StationPerson("Müller Hans", "Hauptmann", ("F",)),
    StationPerson("Schneider Peter", "Oberleutnant", ("F", "Hö")),
    StationPerson("Weber Martin", "Oberleutnant", ("F", "Fw")),
    StationPerson("Fischer Thomas", "Leutnant", ()),
    StationPerson("Meyer Stefan", "Leutnant", ("F",), demo=False),
    StationPerson("Wagner Klaus", "Leutnant", ("F", "Hö"), demo=False),
    StationPerson("Becker Andreas", "Leutnant", ("F", "Fw"), demo=False),
    StationPerson("Ackermann Reto", "Major", ("F",), dev=False),
    # Höhere Unteroffiziere
    StationPerson("Hoffmann Lisa", "Feldweibel", ("F",)),
    StationPerson("Schmidt Daniel", "Feldweibel", ("F",)),
    StationPerson("Koch René", "Wachtmeister", ("F",)),
    StationPerson("Baumann Michael", "Wachtmeister", ("F", "Fw")),
    StationPerson("Keller Marco", "Wachtmeister", ("F",)),
    StationPerson("Brunner Sarah", "Wachtmeister", ("F", "Hö")),
    StationPerson("Gerber Sandro", "Wachtmeister", ("F",), demo=False),
    StationPerson("Frei Dominik", "Wachtmeister", (), demo=False),
    StationPerson("Huber Stefan", "Wachtmeister", ("F",), demo=False),
    StationPerson("Schmid Tizian", "Wachtmeister", (), demo=False),
    StationPerson("Bühler Nadja", "Wachtmeister", ("F",), dev=False),
    StationPerson("Frei Marc", "Wachtmeister", ("F", "Fw"), dev=False),
    StationPerson("Suter Beat", "Wachtmeister", ("F",), dev=False),
    StationPerson("Widmer Anna", "Wachtmeister", ("Hö",), dev=False),
    # Korporale
    StationPerson("Steiner Lukas", "Korporal", ()),
    StationPerson("Meier Andrea", "Korporal", ("F",)),
    StationPerson("Graf Sven", "Korporal", ("Hö",)),
    StationPerson("Roth Til", "Korporal", ()),
    StationPerson("Lang Dimitri", "Korporal", (), demo=False),
    StationPerson("Kaufmann Alain", "Korporal", ("F",), demo=False),
    StationPerson("Moser Florian", "Korporal", ("Hö",), demo=False),
    StationPerson("Berger Maja", "Korporal", (), demo=False),
    StationPerson("Widmer Nico", "Korporal", (), demo=False),
    StationPerson("Vogel Simon", "Korporal", (), demo=False),
    StationPerson("Egger Olivier", "Korporal", ("F",), demo=False),
    StationPerson("Gerber Elias", "Korporal", ("F",), dev=False),
    StationPerson("Lüthi Sophie", "Korporal", (), dev=False),
    StationPerson("Kaufmann Nico", "Korporal", ("Fw",), dev=False),
    StationPerson("Moser Lea", "Korporal", ("F",), dev=False),
    StationPerson("Wenger Tim", "Korporal", (), dev=False),
    # Mannschaftsgrade
    StationPerson("Zimmermann Fabian", "Gefreiter", ()),
    StationPerson("Wyss Fabio", "Soldat", ()),
    StationPerson("Künzli Klara", "Soldat", ()),
    StationPerson("Studer Samuel", "Gefreiter", ()),
    StationPerson("Schwarz Jan", "Soldat", ("Fw",)),
    StationPerson("Hartmann Mischa", "Soldat", ()),
    StationPerson("Christen Sandro", "Gefreiter", ("Fw",), demo=False),
    StationPerson("Leuenberger Luca", "Soldat", (), demo=False),
    StationPerson("Suter Raoul", "Soldat", (), demo=False),
    StationPerson("Kunz Gabor", "Gefreiter", (), demo=False),
    StationPerson("Ammann Manuel", "Soldat", (), demo=False),
    StationPerson("Burri Alessandro", "Soldat", (), demo=False),
    StationPerson("Wenger Luzia", "Gefreiter", (), demo=False),
    StationPerson("Bühler Rico", "Soldat", (), demo=False),
    StationPerson("Aebischer Yannick", "Soldat", (), demo=False),
    StationPerson("Arnold Samuel", "Gefreiter", (), demo=False),
    StationPerson("Aebi Lionel", "Soldat", (), demo=False),
    StationPerson("Bachmann Simon", "Soldat", (), demo=False),
    StationPerson("Bühlmann Carina", "Gefreiter", (), demo=False),
    StationPerson("Buri Marysol", "Soldat", (), demo=False),
    StationPerson("Gasser Julia", "Soldat", (), demo=False),
    StationPerson("Hofer Max", "Gefreiter", (), demo=False),
    StationPerson("Hess Silvan", "Soldat", (), demo=False),
    StationPerson("Imhof Sebastiaan", "Soldat", (), demo=False),
    StationPerson("Iten Alexandre", "Gefreiter", (), demo=False),
    StationPerson("Jost Melissa", "Soldat", (), demo=False),
    StationPerson("Kaiser Sandra", "Soldat", (), demo=False),
    StationPerson("Käser Koray", "Gefreiter", (), demo=False),
    StationPerson("Kessler Paolo", "Soldat", (), demo=False),
    StationPerson("König Sina", "Soldat", (), demo=False),
    StationPerson("Lehmann Bastian", "Gefreiter", (), demo=False),
    StationPerson("Berger Yves", "Gefreiter", (), dev=False),
    StationPerson("Christen Mia", "Soldat", (), dev=False),
    StationPerson("Vogel Timo", "Soldat", (), dev=False),
    StationPerson("Egli Sarah", "Gefreiter", (), dev=False),
    StationPerson("Bianchi Luca", "Soldat", ("Fw",), dev=False),
    StationPerson("Portmann Jonas", "Soldat", (), dev=False),
)


def add_station_vehicles(db: AsyncSession) -> list[models.Vehicle]:
    """Add the fleet (all available) to the session, in display order."""
    vehicles = [models.Vehicle(id=uuid4(), status="available", **row) for row in STATION_VEHICLES]
    db.add_all(vehicles)
    return vehicles


def add_station_roster(db: AsyncSession, fixture: Fixture) -> list[models.Personnel]:
    """Add the fixture's people (all available) to the session, in roster order.

    `role_sort_order` is the Grad's place in ``ranks.RANKS``, so the board lists them most
    senior first rather than alphabetically by Grad.
    """
    role_order = {rank.label: position for position, rank in enumerate(RANKS, start=1)}
    people = [
        models.Personnel(
            id=uuid4(),
            name=person.name,
            role=person.role,
            status="available",
            tags=list(person.tags),
            role_sort_order=role_order.get(person.role, 99),
        )
        for person in STATION_ROSTER
        if (person.dev if fixture == "dev" else person.demo)
    ]
    db.add_all(people)
    return people
