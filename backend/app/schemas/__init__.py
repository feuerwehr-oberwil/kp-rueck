"""
Pydantic schemas split by domain.

Backward compatibility: `from app import schemas` still works — every public
name from the original schemas.py is re-exported here.
"""

from .alarms import *  # noqa: F403
from .assignments import *  # noqa: F403
from .audit import *  # noqa: F403
from .auftrag_templates import *  # noqa: F403
from .common import *  # noqa: F403
from .divera import *  # noqa: F403
from .events import *  # noqa: F403
from .feld import *  # noqa: F403
from .groups import *  # noqa: F403
from .incidents import *  # noqa: F403
from .materials import *  # noqa: F403
from .notifications import *  # noqa: F403
from .personnel import *  # noqa: F403
from .printing import *  # noqa: F403
from .reko import *  # noqa: F403
from .sync import *  # noqa: F403
from .training import *  # noqa: F403
from .user import *  # noqa: F403
from .vehicles import *  # noqa: F403
from .viewer import *  # noqa: F403
