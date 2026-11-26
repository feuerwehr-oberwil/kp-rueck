"""Seed data, run at boot and on demo resets – not one-off scripts.

- ``boot``: ``python -m app.seeds`` on every start (``start.sh``): accounts, station settings,
  the training templates, and – outside production – the dev fixture. ``--dev-logins``
  upserts the local logins into a synced database.
- ``demo``: the public demo's seed, every nightly reset and every ``POST /api/demo/sandbox``.
- ``training``: the Übung templates and sample locations (both seeds call it).
- ``visual``: the screenshot fixture, ``python -m app.seeds.visual`` on an empty database.
- ``station``: the sample fleet and roster the dev and demo fixtures share.

Under the blocking mypy step (ci.yml): rows are TypedDicts or model constructors, so a
misspelt column fails the type check, or SQLAlchemy's constructor at the latest.
"""
