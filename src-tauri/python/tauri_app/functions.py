from pytauri import Commands
import sys
from os import getenv
from .types import _BaseModel

PYTAURI_GEN_TS = getenv("PYTAURI_GEN_TS") != "0"
commands = Commands(experimental_gen_ts=PYTAURI_GEN_TS)

class Person(_BaseModel):
    name: str
class Greeting(_BaseModel):
    message: str

@commands.command()
async def greet(body: Person) -> Greeting:
    return Greeting(
        message=f"Hello, {body.name}! You've been greeted from ur best friend: {sys.version}!"
    )

@commands.command()
async def get_version() -> str:
    return sys.version