"""Has this Schadenplatz ever been disponiert? (plan 25 §18.27)

The rule the whole rapport gate hangs off. It is asked per card on a storm night,
so it is a batch answer; and it is asked about incidents that are already closed,
so it is a question about history rather than about the current column.

The interesting cases are the two edges: an incident that jumped a column, and
one that was closed without anybody ever going out. Those pull in opposite
directions, and getting either one wrong is a visible bug on the board.
"""

from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import incidents as incident_crud
from app.models import Event, Incident, StatusTransition, User
from app.services.incident_dispatch import dispatched_incident_ids, is_dispatched, rapport_applies


async def _incident(db: AsyncSession, event: Event, user: User, title: str, status: str) -> Incident:
    incident = Incident(
        id=uuid4(),
        title=title,
        type="elementarereignis",
        priority="medium",
        location_address=f"{title}weg 1, Oberwil",
        status=status,
        event_id=event.id,
        created_by=user.id,
    )
    db.add(incident)
    await db.commit()
    await db.refresh(incident)
    return incident


async def _move(db: AsyncSession, incident: Incident, from_status: str, to_status: str) -> None:
    db.add(StatusTransition(incident_id=incident.id, from_status=from_status, to_status=to_status))
    incident.status = to_status
    await db.commit()
    await db.refresh(incident)


class TestDispatchedIncidentIds:
    async def test_a_card_that_only_ever_sat_in_the_intake_columns_is_not_dispatched(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Eingegangen, Reko, Reko abgeschlossen: nobody was sent anywhere, and a
        # Reko visit is answered by the Reko-Meldung, not by a rapport.
        incoming = await _incident(db_session, test_event, test_user, "Eingegangen", "incoming")
        reko = await _incident(db_session, test_event, test_user, "Reko", "incoming")
        await _move(db_session, reko, "incoming", "reko")
        await _move(db_session, reko, "reko", "reko_done")

        dispatched = await dispatched_incident_ids(db_session, [incoming, reko])
        assert dispatched == set()

    async def test_it_answers_ever_and_not_now(self, db_session: AsyncSession, test_event: Event, test_user: User):
        # The state most rapports are actually filed in: the crew is home, the
        # card is archived, and the paperwork is what is left. A rule reading the
        # current status would hide the rapport exactly here.
        incident = await _incident(db_session, test_event, test_user, "Keller", "incoming")
        await _move(db_session, incident, "incoming", "enroute")
        await _move(db_session, incident, "enroute", "active")
        await _move(db_session, incident, "active", "complete")

        assert await is_dispatched(db_session, incident) is True

    async def test_a_card_dragged_back_to_the_intake_keeps_its_answer(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # `from_status` counts too — the transition out of a working column is
        # just as much proof as the transition into one.
        incident = await _incident(db_session, test_event, test_user, "Zurueck", "incoming")
        await _move(db_session, incident, "incoming", "active")
        await _move(db_session, incident, "active", "incoming")

        assert await is_dispatched(db_session, incident) is True

    async def test_an_incident_created_straight_into_a_working_column_counts(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # The alarm intake and the training generator both do this, and there is
        # no transition row to show for it.
        incident = await _incident(db_session, test_event, test_user, "Alarm", "enroute")
        assert await is_dispatched(db_session, incident) is True

    async def test_a_column_jump_into_einsatz_counts_as_dispatched(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # The board allows a drag into any column, and crews are often sent by
        # radio while the operator catches the card up afterwards. Denying the
        # rapport here would hide it on an incident that genuinely had crews out.
        incident = await _incident(db_session, test_event, test_user, "Sprung", "incoming")
        await _move(db_session, incident, "incoming", "active")

        assert await is_dispatched(db_session, incident) is True

    async def test_closing_a_card_without_ever_working_it_is_not_dispatched(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        # Eingegangen → Abgeschlossen in one drag: the false alarm, the
        # duplicate, the call that resolved itself. This is the case the whole
        # rule exists for — and it is why `complete` is not evidence on its own.
        incident = await _incident(db_session, test_event, test_user, "Fehlalarm", "incoming")
        await _move(db_session, incident, "incoming", "complete")

        assert await is_dispatched(db_session, incident) is False

    async def test_the_whole_board_is_one_query_worth_of_answers(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        never = await _incident(db_session, test_event, test_user, "Nie", "incoming")
        now = await _incident(db_session, test_event, test_user, "Jetzt", "enroute")
        once = await _incident(db_session, test_event, test_user, "Einmal", "incoming")
        await _move(db_session, once, "incoming", "returning")
        await _move(db_session, once, "returning", "complete")

        dispatched = await dispatched_incident_ids(db_session, [never, now, once])
        assert dispatched == {now.id, once.id}


class TestRapportApplies:
    def test_written_work_is_never_hidden(self):
        # Data older than the rule, or a card whose history says otherwise.
        assert rapport_applies(dispatched=False, has_report=True) is True

    def test_no_report_and_no_dispatch_means_no_rapport(self):
        assert rapport_applies(dispatched=False, has_report=False) is False

    def test_dispatch_alone_is_enough(self):
        assert rapport_applies(dispatched=True, has_report=False) is True


class TestBoardFlag:
    async def test_the_board_carries_the_answer_on_both_read_paths(
        self, db_session: AsyncSession, test_event: Event, test_user: User
    ):
        """The list query and the single-incident query must agree.

        They are separate code paths — one batches, one does not — and a board
        whose card chip disagreed with its own detail would be worse than either
        being wrong on its own.
        """
        incident = await _incident(db_session, test_event, test_user, "Beides", "incoming")

        listed = await incident_crud.get_incidents(db_session, event_id=test_event.id)
        ours = next(inc for inc in listed if inc.id == incident.id)
        assert ours.has_been_dispatched is False
        single = await incident_crud.get_incident(db_session, incident.id)
        assert single is not None
        assert single.has_been_dispatched is False

        await _move(db_session, incident, "incoming", "enroute")

        listed = await incident_crud.get_incidents(db_session, event_id=test_event.id)
        ours = next(inc for inc in listed if inc.id == incident.id)
        assert ours.has_been_dispatched is True
        single = await incident_crud.get_incident(db_session, incident.id)
        assert single is not None
        assert single.has_been_dispatched is True
