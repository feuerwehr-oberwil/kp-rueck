"""Tests for training simulation data — Reko summary pool resolver.

The resolver decides which pool of summary sentences a Reko auto-fill
draws from. These tests lock the contract that a dispatch about, say,
a kitchen fire never produces a Reko summary about a dachstock fire.
"""

import random
import re
from datetime import UTC, datetime
from uuid import uuid4

from app.seed_training import EMERGENCY_TEMPLATES
from app.services.training_simulation_data import (
    _NICE_CM,
    _NICE_LITER,
    _NICE_M,
    _SUMMARIES,
    _get_elementar_subcategory,
    _reconcile_with_summary,
    _resolve_summary_pool,
    classify_material_bucket,
    derive_scenario,
    generate_rapport_data,
    generate_reko_report_data,
    generate_summary,
    vary_dispatch_numbers,
)


class TestResolveSummaryPool:
    """Subcategory resolution per top-level incident type."""

    # --- elementarereignis (existing behaviour, regression coverage) ---

    def test_elementar_water_from_title(self):
        assert _resolve_summary_pool("elementarereignis", "Wasser im Keller", None) == "elementar_water"

    def test_elementar_water_from_description_only(self):
        assert (
            _resolve_summary_pool("elementarereignis", "Pumpeinsatz MFH", "Hochwasser im UG, ca. 30cm")
            == "elementar_water"
        )

    def test_elementar_tree_from_title(self):
        assert _resolve_summary_pool("elementarereignis", "Baum auf Strasse", None) == "elementar_tree"

    def test_elementar_storm_from_title(self):
        assert _resolve_summary_pool("elementarereignis", "Dachziegel gelöst", None) == "elementar_storm"

    def test_elementar_fallback(self):
        # No matching keyword → falls back to base elementar pool
        assert _resolve_summary_pool("elementarereignis", "Irgendwas", None) == "elementarereignis"

    # --- brandbekaempfung subcategories ---

    def test_brand_wohnung(self):
        assert (
            _resolve_summary_pool("brandbekaempfung", "Wohnungsbrand", "Brand, Wohnung 2. OG. Starker Rauch.")
            == "brand_wohnung"
        )

    def test_brand_kueche(self):
        assert (
            _resolve_summary_pool("brandbekaempfung", "Küchenbrand", "Brand klein, Küche Fettbrand.") == "brand_kueche"
        )

    def test_brand_fahrzeug_from_title(self):
        assert (
            _resolve_summary_pool("brandbekaempfung", "Fahrzeugbrand", "Fahrzeugbrand auf Parkplatz.")
            == "brand_fahrzeug"
        )

    def test_brand_fahrzeug_tiefgarage(self):
        # "Brand Tiefgarage" should map to fahrzeug, not werkstatt
        assert (
            _resolve_summary_pool(
                "brandbekaempfung", "Brand Tiefgarage", "Rauch aus Tiefgarage, vermutlich Fahrzeugbrand."
            )
            == "brand_fahrzeug"
        )

    def test_brand_dachstock(self):
        assert (
            _resolve_summary_pool(
                "brandbekaempfung", "Brand Dachstock", "Brand, Dachstock MFH. Flammen durch Dach sichtbar."
            )
            == "brand_dachstock"
        )

    def test_brand_ebike(self):
        assert (
            _resolve_summary_pool("brandbekaempfung", "E-Bike Brand Keller", "Brand, E-Bike-Akku im Veloraum.")
            == "brand_ebike"
        )

    def test_brand_abfall(self):
        assert (
            _resolve_summary_pool(
                "brandbekaempfung", "Brand Abfallcontainer", "Brand klein, Abfallcontainer unter Vordach."
            )
            == "brand_abfall"
        )

    def test_brand_werkstatt(self):
        assert (
            _resolve_summary_pool(
                "brandbekaempfung", "Brand Werkstatt", "Brand, Schreinerei. Starke Flammen, viel Holz."
            )
            == "brand_werkstatt"
        )

    def test_brand_generic_fallback(self):
        # No keyword hit → base brand pool
        assert _resolve_summary_pool("brandbekaempfung", "Brand", "Starke Rauchentwicklung.") == "brandbekaempfung"

    # --- bma subcategories ---

    def test_bma_schule(self):
        assert (
            _resolve_summary_pool("bma_unechte_alarme", "BMA Schulhaus", "BMA, Schulhaus. Evakuation läuft.")
            == "bma_schule"
        )

    def test_bma_pflegeheim(self):
        assert (
            _resolve_summary_pool("bma_unechte_alarme", "BMA Altersheim", "BMA, Pflegeheim. Melder 2. Stock Ost.")
            == "bma_pflegeheim"
        )

    def test_bma_gewerbe(self):
        assert _resolve_summary_pool("bma_unechte_alarme", "BMA Gewerbe", "BMA, Industriebetrieb.") == "bma_gewerbe"

    def test_bma_oeffentlich(self):
        assert (
            _resolve_summary_pool(
                "bma_unechte_alarme", "BMA Einkaufszentrum", "BMA, Einkaufszentrum. Melder Küche Food Court."
            )
            == "bma_oeffentlich"
        )

    # --- strassenrettung subcategories ---

    def test_personenrettung_lift(self):
        assert (
            _resolve_summary_pool("strassenrettung", "Person in Lift", "Person in Lift eingeschlossen, 4. OG.")
            == "personenrettung_lift"
        )

    def test_personenrettung_vu(self):
        assert (
            _resolve_summary_pool(
                "strassenrettung", "Verkehrsunfall eingeklemmt", "VU, 2 PKW. Eine Person eingeklemmt."
            )
            == "personenrettung_vu"
        )

    def test_personenrettung_absturz(self):
        assert (
            _resolve_summary_pool("strassenrettung", "Absturz Baugerüst", "Person ab Gerüst gestürzt, ca. 3m.")
            == "personenrettung_absturz"
        )

    # --- oelwehr subcategories ---

    def test_oel_keller(self):
        assert (
            _resolve_summary_pool("oelwehr", "Heizöl im Keller", "Ölwehr, Heizöltank leckt. Ca. 50 Liter im Keller.")
            == "oel_keller"
        )

    def test_oel_strasse(self):
        assert (
            _resolve_summary_pool("oelwehr", "Ölspur Hauptstrasse", "Ölspur auf Fahrbahn. Ca. 100m lang.")
            == "oel_strasse"
        )

    def test_oel_strasse_kreisel(self):
        assert (
            _resolve_summary_pool("oelwehr", "Ölspur Kreisel", "Ölspur im Kreisel, LKW verliert Hydrauliköl.")
            == "oel_strasse"
        )

    # --- technische_hilfeleistung subcategories ---

    def test_tech_dach(self):
        assert _resolve_summary_pool("technische_hilfeleistung", "Dach abgedeckt", "Dachziegel lose.") == "tech_dach"

    def test_tech_tor_lift(self):
        assert (
            _resolve_summary_pool("technische_hilfeleistung", "Tiefgaragentor klemmt", "Tiefgaragentor blockiert.")
            == "tech_tor_lift"
        )

    def test_tech_versorgung(self):
        assert (
            _resolve_summary_pool(
                "technische_hilfeleistung", "Bagger reisst Wasserleitung", "Bagger hat Wasserleitung erwischt."
            )
            == "tech_versorgung"
        )

    # --- diverse_einsaetze ---

    def test_diverse_wespen(self):
        assert (
            _resolve_summary_pool("diverse_einsaetze", "Wespennest am Schulhaus", "Wespennest beim Eingang Schule.")
            == "div_wespen"
        )

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
        # Effort must stay within each subcategory's profile bounds — water
        # (2..5), tree (2..4, short). Reconciliation may push a value to the
        # floor ("Kontrolle genügt") or ceiling ("Verstärkung"), but never out
        # of the profile range.
        for _ in range(100):
            water = generate_reko_report_data(
                "elementarereignis", title="Wasser im Keller", description="Hochwasser MFH."
            )
            assert 2 <= water["effort_json"]["personnel_count"] <= 5

            tree = generate_reko_report_data(
                "elementarereignis", title="Baum auf Strasse", description="Ast blockiert Fahrbahn."
            )
            assert 2 <= tree["effort_json"]["personnel_count"] <= 4
            assert tree["effort_json"]["estimated_duration_hours"] <= 2

    def test_diverse_einsaetze_relevance_lowered(self):
        # 60% relevant baseline for diverse — over 200 samples the average
        # should sit well below the 90% baseline of other types.
        relevant = sum(
            1 for _ in range(200) if generate_reko_report_data("diverse_einsaetze", title="Türöffnung")["is_relevant"]
        )
        assert relevant < 160, f"expected < 80% relevant, got {relevant / 200:.0%}"


class TestTemplateClassificationConsistency:
    """Regression guard for the dispatch↔reko association.

    Locks the fix for 'Dach abgedeckt' (a roof/storm incident) occasionally
    producing a cellar-water reko: a template's scenario must not flip between
    its (randomly chosen) title and message variations.
    """

    @staticmethod
    def _elementar_templates():
        return [t for t in EMERGENCY_TEMPLATES if t["incident_type"] == "elementarereignis"]

    def test_every_elementar_template_classifies_consistently(self):
        for t in self._elementar_templates():
            titles = [t["title_pattern"], *t.get("title_variations", [])]
            messages = [t["message_pattern"], *t.get("message_variations", [])]
            classes = {_get_elementar_subcategory(title, msg) for title in titles for msg in messages}
            expected = _get_elementar_subcategory(t["title_pattern"])
            assert classes == {expected}, (
                f"{t['title_pattern']!r} classifies inconsistently across its variations: {sorted(classes)}"
            )

    def test_every_elementar_title_is_concrete(self):
        # Every authored elementar template must resolve to water / tree / storm —
        # never the mixed fallback pool, which can return an off-scenario reko.
        for t in self._elementar_templates():
            sub = _get_elementar_subcategory(t["title_pattern"])
            assert sub in ("elementar_water", "elementar_tree", "elementar_storm"), (
                f"{t['title_pattern']!r} lands in the mixed pool ({sub}) — add a keyword"
            )


class TestScenarioAssociation:
    """The user's example, end-to-end: a roof incident never gets a water reko."""

    def test_roof_incident_never_yields_water_reko(self):
        for _ in range(60):
            data = generate_reko_report_data(
                "elementarereignis",
                title="Dach abgedeckt",
                description="Sturm hat Dachfläche abgedeckt, Ziegel auf Strasse. Regen dringt ein.",
            )
            assert data["summary_text"] in _SUMMARIES["elementar_storm"], data["summary_text"]

    def test_tree_incident_yields_tree_reko(self):
        for _ in range(60):
            data = generate_reko_report_data(
                "elementarereignis", title="Baum auf Strasse", description="Baum blockiert Fahrbahn."
            )
            assert data["summary_text"] in _SUMMARIES["elementar_tree"], data["summary_text"]


class TestVaryDispatchNumbers:
    """Jittered dispatch figures must be round estimate values, never '21cm'."""

    @staticmethod
    def _nums(text, unit):
        return [int(n) for n in re.findall(rf"(\d+)\s?{unit}", text)]

    def test_numbers_snap_to_ladder(self):
        sample = "Ca. 25cm Wasser, 20-30cm im UG. Heizöl 50 Liter, Spur 100m."
        for _ in range(100):
            out = vary_dispatch_numbers(sample)
            assert self._nums(out, "cm"), f"cm figure vanished: {out}"
            for n in self._nums(out, "cm"):
                assert n in _NICE_CM, out
            for n in self._nums(out, "Liter"):
                assert n in _NICE_LITER, out
            for n in self._nums(out, r"m\b"):
                assert n in _NICE_M, out

    def test_text_without_numbers_is_unchanged(self):
        text = "Wasser durch Kellerfenster, Waschküche betroffen."
        assert vary_dispatch_numbers(text) == text


class TestRekoConsistency:
    """Summary prose and the danger/effort badges must agree."""

    @staticmethod
    def _dangers(value=False):
        return {
            "fire": value,
            "fire_danger": value,
            "explosion": value,
            "collapse": value,
            "chemical": value,
            "electrical": value,
            "other_notes": None,
        }

    @staticmethod
    def _effort(personnel, hours):
        return {
            "personnel_count": personnel,
            "vehicles_needed": [],
            "equipment_needed": [],
            "estimated_duration_hours": hours,
        }

    def test_asserted_danger_forced_on(self):
        dangers, _ = _reconcile_with_summary(
            "Dachstuhl in Vollbrand, Sparren durchgebrannt. Einsturzgefahr.",
            "brand_dachstock",
            self._dangers(False),
            self._effort(4, 2),
        )
        assert dangers["collapse"] is True
        assert dangers["fire_danger"] is True

    def test_fire_danger_only_asserted_for_brand_types(self):
        # A false-alarm summary mentioning 'Flammen' shouldn't light fire_danger
        # on a non-brand type.
        dangers, _ = _reconcile_with_summary(
            "Nachbar meldet Flammen — vor Ort nichts, Fehlalarm.",
            "bma_unechte_alarme",
            self._dangers(False),
            self._effort(2, 1),
        )
        assert dangers["fire_danger"] is False

    def test_harmless_clears_all_dangers(self):
        dangers, _ = _reconcile_with_summary(
            "BMA hat angesprochen. Kein Rauch, Täuschungsalarm.",
            "bma_unechte_alarme",
            self._dangers(True),
            self._effort(4, 2),
        )
        assert not any(dangers[k] for k in ("fire", "fire_danger", "explosion", "collapse", "chemical", "electrical"))

    def test_small_effort_floors_personnel(self):
        _, effort = _reconcile_with_summary(
            "Keller trocken bei Ankunft. Kontrolle genügt.",
            "elementar_water",
            self._dangers(False),
            self._effort(8, 4),
        )
        assert effort["personnel_count"] == 2  # elementar_water profile min
        assert effort["estimated_duration_hours"] == 1

    def test_large_effort_raises_personnel(self):
        _, effort = _reconcile_with_summary(
            "Vollbrand, Verstärkung und DLK nötig, Aussenangriff.",
            "brandbekaempfung",
            self._dangers(False),
            self._effort(3, 2),
        )
        assert effort["personnel_count"] == 8  # brandbekaempfung profile max


class TestDispatchLinkedSummary:
    """Water/oil rekos confirm or correct the dispatched figure, with round numbers."""

    def test_water_reko_references_dispatch_and_rounds(self):
        seen_confirm = seen_correction = False
        for _ in range(80):
            data = generate_reko_report_data(
                "elementarereignis", title="Wasser im Keller", description="Ca. 30cm Wasser, Heizung betroffen."
            )
            summary = data["summary_text"]
            for n in (int(x) for x in re.findall(r"(\d+)cm", summary)):
                assert n in _NICE_CM, summary
            if "wie gemeldet" in summary:
                seen_confirm = True
            if summary.startswith("Gemeldet"):
                seen_correction = True
        assert seen_confirm and seen_correction, "both confirm and correction branches should occur"


class TestRapportGeneration:
    """The Schadenplatz-Rapport profile (plan 25 §16.1).

    Seeded RNG throughout: these are rules, not distributions, and a test that
    passes four times out of five is worse than no test.
    """

    UNITS = [
        {"assignment_id": uuid4(), "name": "Tauchpumpe Gr.", "type": "Tauchpumpen", "consumable": False},
        {"assignment_id": uuid4(), "name": "Motorsäge Gr.", "type": "Sägen", "consumable": False},
        {"assignment_id": uuid4(), "name": "Anhänger", "type": "Sonstiges", "consumable": False},
        {"assignment_id": uuid4(), "name": "Ölbindemittel", "type": "Ölwehr", "consumable": True},
        {"assignment_id": uuid4(), "name": "Rettungsplattform", "type": "Sonstiges", "consumable": False},
    ]

    VEHICLES = [
        {"assignment_id": uuid4(), "name": "TLF 1"},
        {"assignment_id": uuid4(), "name": "MTW"},
    ]

    def _generate(self, seed: int, incident_type: str = "elementarereignis", title: str = "Wasser im Keller"):
        return generate_rapport_data(
            incident_type=incident_type,
            title=title,
            description="Ca. 30 cm Wasser im Keller.",
            materials=self.UNITS,
            vehicles=self.VEHICLES,
            board_personnel_count=4,
            default_work_started_at=datetime(2026, 8, 9, 20, 0, tzinfo=UTC),
            default_work_ended_at=datetime(2026, 8, 9, 22, 0, tzinfo=UTC),
            rng=random.Random(seed),
        )

    def test_consumables_are_never_left_on_site(self):
        """Decision 26: a consumable that was used is gone. 0 %, always."""
        consumable_id = self.UNITS[3]["assignment_id"]
        for seed in range(300):
            ticks = {row["assignment_id"]: row for row in self._generate(seed).get("materials", [])}
            assert ticks[consumable_id]["left_on_site"] is False

    def test_kfz_block_stays_empty_unless_a_vehicle_is_involved(self):
        """Every IncidentType outside the table is 0 % — not "rarely"."""
        for seed in range(300):
            data = self._generate(seed)
            assert "vehicle_plate" not in data
            assert "vehicle_model" not in data

    def test_kfz_block_appears_on_strassenrettung(self):
        """…and 80 % on a Strassenrettung, so the block is reachable at all."""
        filled = sum(
            1
            for seed in range(200)
            if "vehicle_plate" in self._generate(seed, incident_type="strassenrettung", title="Verkehrsunfall")
        )
        assert 130 < filled < 190

    def test_material_buckets_follow_the_keyword_table(self):
        """Type AND name are matched, with the documented fallback for the rest."""
        assert classify_material_bucket("Tauchpumpen", "Tauchpumpe Gr.", False) == "stays"
        assert classify_material_bucket("Sägen", "Motorsäge Gr.", False) == "goes_home"
        assert classify_material_bucket("Elektrowerkzeug", "Trennschleifer", False) == "goes_home"
        assert classify_material_bucket("Sonstiges", "Anhänger", False) == "trailer"
        assert classify_material_bucket("Ölwehr", "Ölbindemittel", True) == "consumable"
        # Nothing matched: the fallback, never a crash and never an enum.
        assert classify_material_bucket("Sonstiges", "Rettungsplattform", False) == "unknown"

    def test_scenario_follows_the_incident_when_it_says_so(self):
        """Generator-internal flavour: it picks the phrase bank, it is never stored."""
        rng = random.Random(1)
        assert derive_scenario("Wasser im Keller", None, rng) == "wasserschaden"
        assert derive_scenario("Baum auf Fahrbahn", None, rng) == "sturmschaden"
        assert derive_scenario("Schneebruch Vordach", None, rng) == "schneebruch"
        # Nothing to go on: weighted random, but always one of the four.
        assert derive_scenario("Einsatz", None, rng) in {
            "wasserschaden",
            "sturmschaden",
            "schneebruch",
            "anderes",
        }

    def test_the_scenario_never_reaches_the_payload(self):
        """There is no Schadensart field any more, and this must not grow one back."""
        for seed in range(50):
            data = self._generate(seed)
            assert "damage_type" not in data
            assert "damage_type_other" not in data

    def test_the_vehicle_checklist_is_answered_and_mostly_confirmed(self):
        """Prefilled ticked, so the only thing a crew adds is the rare No."""
        unticked = 0
        for seed in range(300):
            rows = self._generate(seed)["vehicles"]
            assert {row["assignment_id"] for row in rows} == {unit["assignment_id"] for unit in self.VEHICLES}
            unticked += sum(1 for row in rows if row["present"] is False)
        # 10 % per vehicle over 600 rows — often enough to train on, rare enough
        # that it stays a signal.
        assert 20 < unticked < 110

    def test_counts_and_times_are_sent_only_when_the_crew_changed_them(self):
        """10 % each — the `korrigiert` marker has to stay a signal (§16.1)."""
        corrected = sum(1 for seed in range(300) if "personnel_count" in self._generate(seed))
        adjusted = sum(1 for seed in range(300) if "work_started_at" in self._generate(seed))
        assert 10 < corrected < 70
        assert 10 < adjusted < 70

    def test_every_rapport_is_submitted_with_a_kurzbericht(self):
        """100 % Kurzbericht, and the inject always files rather than drafts."""
        for seed in range(50):
            data = self._generate(seed)
            assert data["is_draft"] is False
            assert data["kurzbericht"]
