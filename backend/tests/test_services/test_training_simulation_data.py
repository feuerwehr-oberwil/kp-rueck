"""Tests for training simulation data — Reko summary pool resolver.

The resolver decides which pool of summary sentences a Reko auto-fill
draws from. These tests lock the contract that a dispatch about, say,
a kitchen fire never produces a Reko summary about a dachstock fire.
"""

from app.services.training_simulation_data import (
    _SUMMARIES,
    _resolve_summary_pool,
    generate_reko_report_data,
    generate_summary,
)


class TestResolveSummaryPool:
    """Subcategory resolution per top-level incident type."""

    # --- elementarereignis (existing behaviour, regression coverage) ---

    def test_elementar_water_from_title(self):
        assert _resolve_summary_pool("elementarereignis", "Wasser im Keller", None) == "elementar_water"

    def test_elementar_water_from_description_only(self):
        assert _resolve_summary_pool(
            "elementarereignis", "Pumpeinsatz MFH", "Hochwasser im UG, ca. 30cm"
        ) == "elementar_water"

    def test_elementar_tree_from_title(self):
        assert _resolve_summary_pool("elementarereignis", "Baum auf Strasse", None) == "elementar_tree"

    def test_elementar_storm_from_title(self):
        assert _resolve_summary_pool("elementarereignis", "Dachziegel gelöst", None) == "elementar_storm"

    def test_elementar_fallback(self):
        # No matching keyword → falls back to base elementar pool
        assert _resolve_summary_pool("elementarereignis", "Irgendwas", None) == "elementarereignis"

    # --- brandbekaempfung subcategories ---

    def test_brand_wohnung(self):
        assert _resolve_summary_pool(
            "brandbekaempfung", "Wohnungsbrand", "Brand, Wohnung 2. OG. Starker Rauch."
        ) == "brand_wohnung"

    def test_brand_kueche(self):
        assert _resolve_summary_pool(
            "brandbekaempfung", "Küchenbrand", "Brand klein, Küche Fettbrand."
        ) == "brand_kueche"

    def test_brand_fahrzeug_from_title(self):
        assert _resolve_summary_pool(
            "brandbekaempfung", "Fahrzeugbrand", "Fahrzeugbrand auf Parkplatz."
        ) == "brand_fahrzeug"

    def test_brand_fahrzeug_tiefgarage(self):
        # "Brand Tiefgarage" should map to fahrzeug, not werkstatt
        assert _resolve_summary_pool(
            "brandbekaempfung", "Brand Tiefgarage", "Rauch aus Tiefgarage, vermutlich Fahrzeugbrand."
        ) == "brand_fahrzeug"

    def test_brand_dachstock(self):
        assert _resolve_summary_pool(
            "brandbekaempfung", "Brand Dachstock", "Brand, Dachstock MFH. Flammen durch Dach sichtbar."
        ) == "brand_dachstock"

    def test_brand_ebike(self):
        assert _resolve_summary_pool(
            "brandbekaempfung", "E-Bike Brand Keller", "Brand, E-Bike-Akku im Veloraum."
        ) == "brand_ebike"

    def test_brand_abfall(self):
        assert _resolve_summary_pool(
            "brandbekaempfung", "Brand Abfallcontainer", "Brand klein, Abfallcontainer unter Vordach."
        ) == "brand_abfall"

    def test_brand_werkstatt(self):
        assert _resolve_summary_pool(
            "brandbekaempfung", "Brand Werkstatt", "Brand, Schreinerei. Starke Flammen, viel Holz."
        ) == "brand_werkstatt"

    def test_brand_generic_fallback(self):
        # No keyword hit → base brand pool
        assert _resolve_summary_pool(
            "brandbekaempfung", "Brand", "Starke Rauchentwicklung."
        ) == "brandbekaempfung"

    # --- bma subcategories ---

    def test_bma_schule(self):
        assert _resolve_summary_pool(
            "bma_unechte_alarme", "BMA Schulhaus", "BMA, Schulhaus. Evakuation läuft."
        ) == "bma_schule"

    def test_bma_pflegeheim(self):
        assert _resolve_summary_pool(
            "bma_unechte_alarme", "BMA Altersheim", "BMA, Pflegeheim. Melder 2. Stock Ost."
        ) == "bma_pflegeheim"

    def test_bma_gewerbe(self):
        assert _resolve_summary_pool(
            "bma_unechte_alarme", "BMA Gewerbe", "BMA, Industriebetrieb."
        ) == "bma_gewerbe"

    def test_bma_oeffentlich(self):
        assert _resolve_summary_pool(
            "bma_unechte_alarme", "BMA Einkaufszentrum", "BMA, Einkaufszentrum. Melder Küche Food Court."
        ) == "bma_oeffentlich"

    # --- strassenrettung subcategories ---

    def test_personenrettung_lift(self):
        assert _resolve_summary_pool(
            "strassenrettung", "Person in Lift", "Person in Lift eingeschlossen, 4. OG."
        ) == "personenrettung_lift"

    def test_personenrettung_vu(self):
        assert _resolve_summary_pool(
            "strassenrettung", "Verkehrsunfall eingeklemmt", "VU, 2 PKW. Eine Person eingeklemmt."
        ) == "personenrettung_vu"

    def test_personenrettung_absturz(self):
        assert _resolve_summary_pool(
            "strassenrettung", "Absturz Baugerüst", "Person ab Gerüst gestürzt, ca. 3m."
        ) == "personenrettung_absturz"

    # --- oelwehr subcategories ---

    def test_oel_keller(self):
        assert _resolve_summary_pool(
            "oelwehr", "Heizöl im Keller", "Ölwehr, Heizöltank leckt. Ca. 50 Liter im Keller."
        ) == "oel_keller"

    def test_oel_strasse(self):
        assert _resolve_summary_pool(
            "oelwehr", "Ölspur Hauptstrasse", "Ölspur auf Fahrbahn. Ca. 100m lang."
        ) == "oel_strasse"

    def test_oel_strasse_kreisel(self):
        assert _resolve_summary_pool(
            "oelwehr", "Ölspur Kreisel", "Ölspur im Kreisel, LKW verliert Hydrauliköl."
        ) == "oel_strasse"

    # --- technische_hilfeleistung subcategories ---

    def test_tech_dach(self):
        assert _resolve_summary_pool(
            "technische_hilfeleistung", "Dach abgedeckt", "Dachziegel lose."
        ) == "tech_dach"

    def test_tech_tor_lift(self):
        assert _resolve_summary_pool(
            "technische_hilfeleistung", "Tiefgaragentor klemmt", "Tiefgaragentor blockiert."
        ) == "tech_tor_lift"

    def test_tech_versorgung(self):
        assert _resolve_summary_pool(
            "technische_hilfeleistung", "Bagger reisst Wasserleitung", "Bagger hat Wasserleitung erwischt."
        ) == "tech_versorgung"

    # --- diverse_einsaetze ---

    def test_diverse_wespen(self):
        assert _resolve_summary_pool(
            "diverse_einsaetze", "Wespennest am Schulhaus", "Wespennest beim Eingang Schule."
        ) == "div_wespen"

    def test_diverse_no_longer_falls_back_to_elementar(self):
        # Wildcard diverse case (no specific subcategory) — used to fall back to
        # elementarereignis water summaries, which made no sense.
        result = _resolve_summary_pool("diverse_einsaetze", "Türöffnung Sanität", "Polizei bittet um Türöffnung")
        assert result == "diverse_einsaetze"

    # --- fallback safety ---

    def test_unknown_type_falls_back_to_elementar(self):
        assert _resolve_summary_pool("totally_unknown_type", "egal", None) == "elementarereignis"

    def test_strahlenwehr_aliases_to_chemiewehr(self):
        assert _resolve_summary_pool("strahlenwehr", "Strahlenunfall", "Quelle gefunden") == "chemiewehr"


class TestPoolDefinitions:
    """Sanity: every pool key the resolver can return must actually exist in _SUMMARIES."""

    def test_all_subcategory_keys_have_pools(self):
        from app.services.training_simulation_data import _TYPE_SUBCATEGORY_KEYWORDS

        for _type_key, subs in _TYPE_SUBCATEGORY_KEYWORDS.items():
            for sub_key, _kws in subs:
                assert sub_key in _SUMMARIES, f"{sub_key} declared but no pool defined"
                assert len(_SUMMARIES[sub_key]) > 0, f"{sub_key} pool is empty"

    def test_elementar_subcategories_have_effort_and_power_profiles(self):
        # Every subcategory the elementar resolver can return must have tuned
        # effort + power profiles, otherwise reko falls back to a generic mismatch.
        from app.services.training_simulation_data import (
            _EFFORT_PROFILES,
            _POWER_SUPPLY_WEIGHTS,
        )

        for sub_key in ("elementar_water", "elementar_tree", "elementar_storm"):
            assert sub_key in _EFFORT_PROFILES, f"{sub_key} missing effort profile"
            assert sub_key in _POWER_SUPPLY_WEIGHTS, f"{sub_key} missing power profile"


class TestGenerateSummary:
    """End-to-end: generate_summary picks from the correct pool."""

    def test_kitchen_brand_never_yields_dachstock_summary(self):
        # Run 50× to catch any randomness leak into a wrong pool
        for _ in range(50):
            result = generate_summary("brandbekaempfung", "Küchenbrand", "Brand klein, Küche Fettbrand.")
            assert result in _SUMMARIES["brand_kueche"], f"unexpected: {result!r}"

    def test_lift_rettung_never_yields_katze_summary(self):
        for _ in range(50):
            result = generate_summary("strassenrettung", "Person in Lift", "Person in Lift eingeschlossen.")
            assert result in _SUMMARIES["personenrettung_lift"], f"unexpected: {result!r}"

    def test_oel_keller_never_yields_strasse_summary(self):
        for _ in range(50):
            result = generate_summary("oelwehr", "Heizöl im Keller", "Heizöltank leckt im Keller.")
            assert result in _SUMMARIES["oel_keller"], f"unexpected: {result!r}"


class TestGenerateRekoReportData:
    """End-to-end: generate_reko_report_data threads description through."""

    def test_description_routes_to_correct_pool(self):
        # Without description, "Brand" alone has no subcategory hit
        # → falls back to base pool. With description, it should hit küche.
        for _ in range(20):
            data = generate_reko_report_data(
                "brandbekaempfung",
                title="Brand",
                description="Brand klein, Küche Fettbrand. Bewohner draussen.",
            )
            assert data["summary_text"] in _SUMMARIES["brand_kueche"]

    def test_elementar_subcategory_drives_effort(self):
        # Water uses the (3,9,..) profile, tree the (2,6,0.5,1.5) profile — so
        # effort should respect those subcategory bounds, not the generic one.
        for _ in range(50):
            water = generate_reko_report_data(
                "elementarereignis", title="Wasser im Keller", description="Hochwasser MFH."
            )
            assert water["effort_json"]["personnel_count"] >= 3

            tree = generate_reko_report_data(
                "elementarereignis", title="Baum auf Strasse", description="Ast blockiert Fahrbahn."
            )
            assert tree["effort_json"]["personnel_count"] <= 6
            assert tree["effort_json"]["estimated_duration_hours"] <= 1.5

    def test_diverse_einsaetze_relevance_lowered(self):
        # 60% relevant baseline for diverse — over 200 samples the average
        # should sit well below the 90% baseline of other types.
        relevant = sum(
            1
            for _ in range(200)
            if generate_reko_report_data("diverse_einsaetze", title="Türöffnung")["is_relevant"]
        )
        assert relevant < 160, f"expected < 80% relevant, got {relevant/200:.0%}"
