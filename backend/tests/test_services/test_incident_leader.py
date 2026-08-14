"""The effective-Einsatzleiter rule (plan 25, decision 29).

Two columns, one question. The order between them is the whole content of the
module, and getting it backwards is invisible until an incident is completed —
so it is asserted here rather than only through the surfaces that use it.
"""

from types import SimpleNamespace
from uuid import uuid4

from app.services.incident_leader import effective_leader_id, effective_leader_ids


def _incident(leader_personnel_id=None):
    return SimpleNamespace(leader_personnel_id=leader_personnel_id)


class TestEffectiveLeader:
    def test_active_flag_wins_over_the_record(self):
        # A running incident whose leader changed since the last stamp must name
        # the person actually leading it, not the one on file.
        active, recorded = uuid4(), uuid4()
        assert effective_leader_id(_incident(recorded), {active}) == active

    def test_the_record_answers_once_the_crew_is_released(self):
        # The case the column exists for: completion clears the flag everywhere.
        recorded = uuid4()
        assert effective_leader_id(_incident(recorded), set()) == recorded

    def test_nobody_ever_led_it(self):
        assert effective_leader_id(_incident(None), set()) is None
        assert effective_leader_ids(_incident(None), set()) == set()

    def test_returns_a_set_for_membership_sorting(self):
        recorded = uuid4()
        assert effective_leader_ids(_incident(recorded), set()) == {recorded}
