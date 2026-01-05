from agno.agent import Agent
from agno.media import Image
from agno.models.litellm import LiteLLM
import litellm

from backend.providers.openrouter import get_openrouter_model

agent = Agent(
    model=get_openrouter_model("nvidia/nemotron-nano-12b-v2-vl:free"),
    tools=[],
    markdown=True,
)

agent.print_response(
    "Tell me about this image.",
    images=[
        Image(
            filepath="GoldenGateBridge-001.jpg"
        )
    ],
    stream=True,
)