"""Request-scoped dependencies: the database connection and the acting demo user."""
from typing import Optional

from fastapi import Header

from .db import get_db  # noqa: F401  (re-exported for routers)
from .services.common import Actor

DEFAULT_NAMES = {"office": "Priya (Office)", "warehouse": "Ravi (Warehouse)"}


def get_actor(x_role: Optional[str] = Header(default=None), x_user: Optional[str] = Header(default=None)) -> Actor:
    """Demo roles instead of full authentication. The frontend sends X-Role / X-User."""
    role = x_role if x_role in ("office", "warehouse") else "office"
    return Actor(name=(x_user or DEFAULT_NAMES[role])[:60], role=role)
