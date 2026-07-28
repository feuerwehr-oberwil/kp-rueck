# 16 – Training alarm intake: who is training, and who gets which alarm

**Status:** the UI was removed on 2026-07-28; the backend path is intact but has no caller.
This plan owns bringing it back **with a recipient model**, not before.

## What was removed, and what still exists

Removed from the Übungssteuerung (`frontend/`):

- `components/training-controls.tsx` – the **"Alarmeingang"** button in *Einzelne Einsätze
  generieren* and its `handleGenerateDivera` handler. The *Telefon-Alarm* button now spans
  the full row.
- `components/training-autogen-controls.tsx` – the **"Alarmweg"** select
  (`Direkt aufs Board` / `Über den Alarmeingang`) plus its `mode` state. The Automatik card
  no longer writes `training_autogen_mode`.
- `messages/de.json` – `training.controls.diveraAlarm`, `toastDiveraInPool`,
  `toastDiveraDescription`, `toastDiveraFailed`, `training.autogen.alarmPath`, `modeBoard`,
  `modeDivera`; the two hint strings lost their Alarmeingang clauses. (`fr.json` / `it.json`
  never carried these keys.)

Still in the tree, dormant and untouched:

| Piece | Where |
|---|---|
| `POST /api/training/events/{event_id}/simulate/divera` | `backend/app/api/training.py:491` |
| `generate_training_divera_emergency` / `TrainingGenerator` | `backend/app/services/training.py:~240-360` |
| Autogen mode branch (`board` \| `divera`) | `backend/app/services/training_autogen_task.py:181` |
| Setting default `training_autogen_mode: "board"` | `backend/app/services/settings.py:29` |
| `DiveraEmergency.is_training` + index | `backend/app/models.py:1007` |
| Pool guards: training entries only attach to training events; excluded from auto-attach | `backend/app/api/divera.py:221,305`, `backend/app/services/divera_intake.py:213` |
| Pytest coverage (3 cases) | `backend/tests/test_api/test_training.py:508-560` |
| Unused client method `simulateDiveraAlarm` | `frontend/lib/api-client.ts:1135` |

Nothing was broken. The buttons worked: an entry appeared in the pool with an ÜBUNG badge,
the alarm sound and toast fired, and the operator could attach it to the exercise. It was
removed because it went unused and because the question below has no answer yet — a control
nobody dares press is worse than no control.

## The actual open question

**Who receives what during an exercise?**

Today the split is implicit and only half-designed:

- **Outbound** (`POST /api/divera/incidents/{id}/alarm`) already short-circuits for training
  events: recipients are resolved and reported so the operator sees how many *would* be
  alarmed, but no external request is made (`backend/app/api/divera.py:646`). Nothing reaches
  the crew's phones — safe, but also not an exercise for the people being alarmed.
- **Inbound** (the removed buttons) put a simulated alarm into the same pool the real
  dispatcher writes into, marked `is_training`. Everyone looking at the pool page sees it,
  training participant or not.

Neither side knows **who is taking part in the exercise**. That is the missing concept. The
fear that follows from not having it is concrete: the moment training alarms stop being
simulated and actually go out via Divera, the entire brigade gets texted for an exercise
three people are running.

## Direction (owner's call, do not re-litigate)

Introduce **"who is training"** as explicit state, then derive both directions from it:

1. A setting / selection of the training audience – personnel, or more likely a group
   (`backend/app/api/groups.py` already models groups) – scoped to the training event.
2. **Outbound**: during training, alarms may go out for real via Divera, but *only* to the
   training audience. Everyone else is skipped with a visible reason, exactly like the
   existing `skipped` list with `"nicht diesem Einsatz zugewiesen"`. The current
   blanket `simulated=True` short-circuit becomes the fallback for "no audience configured".
3. **Inbound**: with an audience defined, normal alarms can be *mirrored* into Divera for
   those people, so participants experience the real alarm on the real device — which is the
   point of running the exercise through the intake path at all.

The intake button comes back once 1–3 exist; it is a small UI restore (see the diff of
commit that removed it), not new frontend work.

## Open questions to settle while planning

- Audience granularity: per training event, or a global "Übungs-Teilnehmer" setting? Per event
  is more honest (two exercises, different crews) but adds a table.
- Does an audience member get real Divera pushes for *live* incidents at the same time, and
  how does the receiver tell an exercise alarm apart from a real one? Divera's own alarm text
  carrying a `ÜBUNG` prefix is the cheap answer; verify it survives the provider payload.
- Divera FREE tier rate-limits triggers to roughly one per five minutes
  (`docs/research/`, competitor research 2026-07-03) – autogen at a one-minute interval would
  hit that wall. Does the audience path need a send budget?
- What happens to `is_training` pool entries nobody attaches? They currently linger.

## Test plan

- **Backend**: extend `backend/tests/test_api/test_training.py` beyond the three existing
  cases – audience resolution (member / non-member / empty audience), outbound recipient
  filtering during training, and the rate-limit guard.
- **Backend**: a test that a live event can never resolve a training audience, and that a
  training alarm cannot reach a non-participant.
- **Frontend**: Vitest for the audience picker; one Playwright spec for the full loop
  (inject → pool alert → attach to exercise → alarm goes only to the audience), tagged
  `@smoke` only if it stays under the budget in plan 15.
- **Regression**: `docs/openapi.json` is regenerated (`just openapi`) whenever the endpoint
  signature changes – a pytest fails on drift.

## Prerequisite check before starting

Confirm the dormant backend still behaves as documented above (it has had no caller since
2026-07-28): run the three existing pytest cases and drive
`POST /api/training/events/{id}/simulate/divera` once by hand against a training event.
