from pathlib import Path

from dotenv import load_dotenv

from zynk import Bridge

from .db import init_database

from . import commands  # noqa: F401


def main() -> int:
    load_dotenv()
    init_database()

    output_dir = Path(__file__).parent.parent / "app" / "python"
    app = Bridge(generate_ts=str(output_dir / "api.ts"), port=8000, debug=False)

    app.run(dev=True)
    return 0


if __name__ == "__main__":
    exit(main())
