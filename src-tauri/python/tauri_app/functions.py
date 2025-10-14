from pytauri import Commands
import sys
from pydantic import BaseModel

commands: Commands = Commands()

class Person(BaseModel):
    name: str
class Greeting(BaseModel):
    message: str

@commands.command()
async def greet(body: Person) -> Greeting:
    return Greeting(
        message=f"Hello, {body.name}! You've been greeted from ur best friend: {sys.version}!"
    )