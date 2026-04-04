"""Backend package marker for frozen builds."""

from .runtime.patches import apply_agno_patches

apply_agno_patches()
