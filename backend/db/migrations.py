from __future__ import annotations

import logging

#from sqlalchemy import inspect

from .core import _get_engine

logger = logging.getLogger(__name__)


def run_migrations() -> None:
    engine = _get_engine()
    if engine is None:
        return

    #inspector = inspect(engine)
    #existing_tables = inspector.get_table_names()

    #with engine.connect() as conn:
    #    pass
