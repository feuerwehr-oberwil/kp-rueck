"""One line for where an incident is: «Hauptstrasse 4, Oberwil» out of a Nominatim address.

Pure string work (no database, no PDF library) – the board's cards, the notifications and
every printed output use it, with the station's home city to leave out.
"""

import re
from typing import NamedTuple

# Country components, as Nominatim writes them. The frontend geocoder sends no
# ``accept-language``, so the Swiss one arrives as the multilingual
# "Schweiz/Suisse/Svizzera/Svizra" – hence the per-token check, which also keeps a
# street like "Schweizerhalle" out of the set.
_COUNTRY_NAMES: frozenset[str] = frozenset(
    {
        "switzerland", "schweiz", "suisse", "svizzera", "svizra",
        "germany", "deutschland", "allemagne", "germania",
        "france", "frankreich", "francia",
        "italy", "italien", "italia", "italie",
        "austria", "österreich", "autriche",
        "liechtenstein",
    }
)  # fmt: skip

_POSTCODE_RE = re.compile(r"\d{4,5}")
# The postcode a geocoded component carries in front of the town ("4104 Oberwil"),
# which the home-city comparison has to look past.
_POSTCODE_PREFIX_RE = re.compile(r"^\d{4,5}\s+")
_WHITESPACE_RE = re.compile(r"\s+")
# A county / district component. Word-bounded on purpose: a bare ``^region`` also
# matched "Regionalstrasse", which would have swallowed a street.
_DISTRICT_RE = re.compile(r"(?:bezirk|region|kanton|canton|district|wahlkreis)\b", re.IGNORECASE)
# Half-cantons that are never a municipality, so they can be dropped by name.
_STATE_NAMES: frozenset[str] = frozenset({"basel-landschaft", "basel-stadt"})

# The 26 Swiss canton abbreviations. A whitelist, NOT a "drop two trailing letters"
# rule: a two-letter word is a legitimate ending for a place or a POI, and a blanket
# rule would quietly rename it. The suffix is only ever removed to COMPARE a component
# with the home city – never from the output, which always echoes the raw component –
# so the worst a mis-strip can do is claim a town IS home and hide it. Hence the canton
# is compared too when both sides name one ("Oberwil BE" ≠ "Oberwil, BL").
_CANTON_ABBREVS: frozenset[str] = frozenset(
    {
        "ag", "ai", "ar", "be", "bl", "bs", "fr", "ge", "gl", "gr", "ju", "lu", "ne",
        "nw", "ow", "sg", "sh", "so", "sz", "tg", "ti", "ur", "vd", "vs", "zg", "zh",
    }
)  # fmt: skip

# The two ways Divera writes the canton onto the town: "Oberwil (BL)" / "Oberwil BL".
_CANTON_PAREN_RE = re.compile(r"^(.+?)\s*\(([A-Za-z]{2})\)$")
_CANTON_BARE_RE = re.compile(r"^(.+?)\s+([A-Za-z]{2})$")

# A component that carries its own house number – "Talstrasse 61", "Mittleri Rüti 5",
# "Bahnhofstrasse 12a". THE street marker, because it is the only one the data offers:
# Divera delivers town and street as bare components in either order, and nothing but
# the trailing number distinguishes a street from a town, a POI ("Coop Center") or
# Divera's status wording ("Nicht mehr einrücken").
#
# Deliberately narrow: at most three digits, so "4104 Oberwil" (number in front) and a
# postcode cannot pose as a street, and something before the number that is neither
# blank nor a digit, so a bare "12" and a coordinate ("47.516377") are excluded. A house
# number of four digits or more is not recognised – the address is then left in the
# order it arrived instead of being reordered on a guess.
_STREET_WITH_NUMBER_RE = re.compile(r"^.*[^\s\d]\s+\d{1,3}[A-Za-z]?(?:\s*[-/]\s*\d{1,3}[A-Za-z]?)?$")


class _CityPart(NamedTuple):
    """A town component split into the name the comparison uses and its canton, if named."""

    name: str
    canton: str | None


def _is_canton_abbrev(part: str) -> bool:
    """A component that is nothing but a canton abbreviation ("Oberwil, BL")."""
    token = part.strip().lower()
    return len(token) == 2 and token in _CANTON_ABBREVS


def _parse_city_part(part: str) -> _CityPart:
    """One address / home-city component in the form the two are compared in.

    No postcode prefix, no canton suffix, no double spaces, lower case. Not a fuzzy
    match – "4104 Oberwil", "Oberwil (BL)" and "Oberwil BL" are the same town written
    four ways, everything else is a different place.
    """
    base = _WHITESPACE_RE.sub(" ", _POSTCODE_PREFIX_RE.sub("", part).strip())
    for pattern in (_CANTON_PAREN_RE, _CANTON_BARE_RE):
        match = pattern.match(base)
        if match and match.group(2).lower() in _CANTON_ABBREVS:
            return _CityPart(match.group(1).strip().lower(), match.group(2).lower())
    return _CityPart(base.lower(), None)


def _parse_home_city(home_city: str) -> tuple[list[str], str | None]:
    """The home-city setting as the town name(s) it holds plus the canton.

    Whether the operator wrote the canton as its own component ("Oberwil, BL") or onto
    the name ("Oberwil (BL)").
    """
    names: list[str] = []
    canton: str | None = None
    for raw in (home_city or "").split(","):
        trimmed = raw.strip()
        if not trimmed:
            continue
        if _is_canton_abbrev(trimmed):
            canton = canton or trimmed.lower()
            continue
        parsed = _parse_city_part(trimmed)
        if not parsed.name:
            continue
        names.append(parsed.name)
        canton = canton or parsed.canton
    return names, canton


def _is_country_part(part: str) -> bool:
    tokens = [t.strip().lower() for t in part.split("/") if t.strip()]
    return bool(tokens) and all(t in _COUNTRY_NAMES for t in tokens)


def _is_address_noise(part: str) -> bool:
    """Postcode / canton / country tail noise – never the street, never the city."""
    if _POSTCODE_RE.fullmatch(part):
        return True
    if _is_country_part(part):
        return True
    if _DISTRICT_RE.match(part):
        return True
    if _is_canton_abbrev(part):
        return True
    return part.lower() in _STATE_NAMES


def _street_component_indexes(kept: list[str]) -> list[int]:
    """Which of the surviving components carry a house number of their own."""
    return [i for i, part in enumerate(kept) if _STREET_WITH_NUMBER_RE.match(part)]


def _render_street_first(kept: list[str], street_idx: int) -> str:
    """The surviving components with the street in front, the rest in their own order."""
    return ", ".join([kept[street_idx], *(p for i, p in enumerate(kept) if i != street_idx)])


def format_location_for_display(full_address: str | None, home_city: str) -> str:
    """Python mirror of the frontend ``formatLocationForDisplay`` (lib/utils.ts).

    Strips home-city / district / canton / country / postcode noise. Returns ``""``
    when the location is only the home city (redundant) so callers can hide or fall
    back.

    Shapes that reach this function, all of them real:

    - ``"Bahnhofstrasse 12, 4133 Pratteln"`` – what the frontend geocoder stores
      today (built from Nominatim's structured ``address`` object, not
      ``display_name``).
    - ``"12, Bahnhofstrasse, Pratteln, Bezirk Liestal, Basel-Landschaft, 4133,
      Schweiz/Suisse/Svizzera/Svizra"`` – a raw Nominatim ``display_name``, i.e.
      house number FIRST, pasted by an operator or held by an older row.
    - The same without a house number (``"Storchenweg, Therwil, …"``), or with
      neither (``"Therwil, Bezirk Arlesheim, …"`` – a place, not an address).
    - ``"Oberwil (BL), Talstrasse 61"`` – what Divera delivers: the TOWN FIRST, the
      canton in parentheses or bare ("Oberwil BL"), optionally a POI after the street
      (``"…, Grenzweg 1, BLT Tramdepot"``) and optionally status wording in front
      (``"Nicht mehr einrücken, Oberwil (BL), Im Lohgraben 60"``).
    - Free text an operator typed, and ``"47.516377, 7.561800"`` from a map pin.

    Because the order is not fixed, the STREET is found by the only marker the data
    offers: a component carrying its own house number ("Talstrasse 61"). If exactly one
    does, it leads the output and every other surviving component follows in its
    original order, so a town-first address is reordered to street-first ("Bottmingen,
    Mittleri Rüti 5" → "Mittleri Rüti 5, Bottmingen") and every card on the board reads
    the same way. If none or several do, the address falls back to the Nominatim reading
    below – never to a guess.

    In that fallback the city is looked up from the END, past the postcode / canton /
    country tail, rather than at a fixed index: index 1 is the STREET in the
    house-number-first shape and the CITY in the short one. A component that sits
    directly after a "Bezirk …" is the canton, not the town ("…, Dornach, Bezirk
    Dorneck, Solothurn, 4143, …"), so it is skipped too.

    The home city is matched component against component, both normalised
    ("4104 Oberwil" ≡ "Oberwil (BL)" ≡ "Oberwil BL" ≡ "Oberwil"), NEVER as a substring:
    the setting holds a town plus its canton ("Oberwil, BL"), and a substring test let
    that "BL" match any component containing the letters – "4223 Blauen",
    "Blauenstrasse" – so a Nachbarhilfe address in a neighbouring town silently lost the
    one part that has to be right. By the same rule "Oberwil im Simmental" is a
    different municipality and keeps its name, and so does "Oberwil BE" – when both
    sides name a canton, the cantons must agree.

    Known limitation: for a canton with no districts whose name differs from the
    town (Carouge GE, Baar ZG), the canton is shown instead of the town. Outside
    Switzerland the state component is not recognised at all.

    The frontend copy and this one are held to the same case table – see
    ``tests/test_services/location_display_cases.json``.
    """
    if not full_address:
        return ""
    # An unset – or blank – home city leaves nothing to strip against, so the
    # address is passed through untouched.
    home_names, home_canton = _parse_home_city(home_city)
    if not home_names:
        return full_address
    parts = [p.strip() for p in full_address.split(",") if p.strip()]

    def is_home_city_part(part: str) -> bool:
        """One whole component equal to one whole component of the setting.

        Postcode prefix and canton suffix looked past; a canton named on both sides has
        to agree, so a different Oberwil keeps its name.
        """
        parsed = _parse_city_part(part)
        if not parsed.name or parsed.name not in home_names:
            return False
        return not parsed.canton or not home_canton or parsed.canton == home_canton

    if any(is_home_city_part(p) for p in parts):
        # Everything that is neither noise nor the home city itself survives – the
        # street, and whatever the dispatch system put around it.
        kept = [p for p in parts if not _is_address_noise(p) and not is_home_city_part(p)]

        # Divera shape: one component carries the house number, so it leads and the
        # POI / status wording follows. With several, the fallback below is the safe
        # reading – here it keeps every component, so nothing is lost either way.
        street_indexes = _street_component_indexes(kept)
        if len(street_indexes) == 1:
            return _render_street_first(kept, street_indexes[0])

        # Nominatim shape: the house number is its own component.
        house_number = ""
        street_name = ""
        rest: list[str] = []
        for part in kept:
            # A postcode was already dropped as noise, so a bare number is the house one.
            if part.isdigit():
                house_number = part
                continue
            if not street_name:
                street_name = part
            else:
                rest.append(part)
        if not street_name:
            return ""  # nothing more specific than the home city
        head = f"{street_name} {house_number}" if house_number else street_name
        return ", ".join([head, *rest])

    # Outside the home city. A town-first shape is reordered so the board reads the
    # same way everywhere.
    kept = [p for p in parts if not _is_address_noise(p)]
    street_indexes = _street_component_indexes(kept)
    if len(street_indexes) == 1:
        return _render_street_first(kept, street_indexes[0])
    # Several house numbers: which one is THE address is a guess, and the reading below
    # keeps only one component beside the street, so it would drop the others. Leave the
    # address exactly as it arrived instead.
    if len(street_indexes) > 1:
        return full_address

    house_number = ""
    street = ""
    street_index = -1
    for idx, part in enumerate(parts):
        if _POSTCODE_RE.fullmatch(part):
            continue
        if part.isdigit():
            house_number = part
            continue
        if street_index == -1:
            street = part
            street_index = idx

    city = ""
    for idx in range(len(parts) - 1, street_index, -1):
        part = parts[idx]
        if part.isdigit() or _is_address_noise(part):
            continue
        # "…, Dornach, Bezirk Dorneck, Solothurn, …" – what follows a district is
        # the canton, and the town is further left.
        if idx > 0 and _DISTRICT_RE.match(parts[idx - 1]):
            continue
        # Never print the street where the city belongs.
        if part.lower() == street.lower():
            continue
        city = part
        break

    formatted_street = " ".join(p for p in (street, house_number) if p)
    return f"{formatted_street}, {city}" if city else formatted_street
