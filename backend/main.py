from pathlib import Path
from dotenv import load_dotenv
from zynk import Bridge

from .db import init_database

def main() -> int:
    load_dotenv()
    init_database()
    
    # Import commands (registers them via @command decorator)
    from .commands import system, chats, streaming, branches # noqa: F401
    
    # Create zynk bridge
    output_dir = Path(__file__).parent.parent / "app" / "python"
    app = Bridge(
        generate_ts=str(output_dir / "api.ts"),
        port=8000,
    )
    
    # Run in dev mode (hot-reload enabled)
    app.run(dev=True)
    return 0

if __name__ == "__main__":
    exit(main())