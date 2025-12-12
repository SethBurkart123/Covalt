from pathlib import Path
from dotenv import load_dotenv
from anyio.from_thread import start_blocking_portal
from pydantic.alias_generators import to_camel
from pytauri import (
    builder_factory,
    context_factory,
)
from tauri_app.db import init_database
from .commands import commands, PYTAURI_GEN_TS

def main() -> int:
    with start_blocking_portal("asyncio") as portal:
        # Ensure environment variables are loaded (e.g., OPENAI_API_KEY)
        load_dotenv()
        if PYTAURI_GEN_TS:
            # ⭐ Generate TypeScript Client to your frontend `src/client` directory
            output_dir = Path(__file__).parent.parent.parent.parent / "app" / "python"
            # ⭐ The CLI to run `json-schema-to-typescript`,
            # `--format=false` is optional to improve performance
            json2ts_cmd = "pnpm json2ts --format=false"

            # ⭐ Start the background task to generate TypeScript types
            portal.start_task_soon(
                lambda: commands.experimental_gen_ts_background(
                    output_dir, json2ts_cmd, cmd_alias=to_camel
                )
            )

        app = builder_factory().build(
            context=context_factory(),
            invoke_handler=commands.generate_handler(portal),
        )
        # Initialize database in the Tauri resource/app dir
        init_database(app)

        exit_code = app.run_return()
        return exit_code
