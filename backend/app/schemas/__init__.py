"""
Pydantic schemas split by domain.

Backward compatibility: `from app import schemas` still works — every public
name from the original schemas.py is re-exported here.
"""

# noqa: F401, F403 — wildcard re-exports are the point of this barrel
from .assignments import *  # noqa: F401, F403
from .audit import *  # noqa: F401, F403
from .common import *  # noqa: F401, F403
from .divera import *  # noqa: F401, F403
from .events import *  # noqa: F401, F403
from .incidents import *  # noqa: F401, F403
from .materials import *  # noqa: F401, F403
from .notifications import *  # noqa: F401, F403
from .personnel import *  # noqa: F401, F403
from .printing import *  # noqa: F401, F403
from .reko import *  # noqa: F401, F403
from .sync import *  # noqa: F401, F403
from .training import *  # noqa: F401, F403
from .user import *  # noqa: F401, F403
from .vehicles import *  # noqa: F401, F403
