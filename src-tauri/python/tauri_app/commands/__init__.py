from __future__ import annotations

from os import getenv
from pytauri import Commands

# Controls whether to run pytauri-gen-ts background type generation
PYTAURI_GEN_TS = getenv("PYTAURI_GEN_TS") != "0"

# Single Commands instance shared across submodules
commands = Commands(experimental_gen_ts=PYTAURI_GEN_TS)

# Register command modules (side-effect import)
from . import system  # noqa: E402, F401
from . import chats  # noqa: E402, F401
from . import streaming  # noqa: E402, F401
from . import branches  # noqa: E402, F401

