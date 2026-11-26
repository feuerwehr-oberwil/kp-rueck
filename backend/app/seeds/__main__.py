"""``python -m app.seeds [--dev-logins]`` – the boot seed (see ``app.seeds.boot``)."""

import asyncio
import sys

from .boot import seed_database, seed_dev_logins

if "--dev-logins" in sys.argv[1:]:
    asyncio.run(seed_dev_logins())
else:
    asyncio.run(seed_database())
