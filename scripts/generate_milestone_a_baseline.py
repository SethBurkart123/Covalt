#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_PATH = ROOT / "tests" / "artifacts" / "milestone-a-baseline.snapshot.json"

VITEST_COMMAND = ["bun", "run", "test", "--run"]
PYTEST_COMMAND = ["uv", "run", "pytest", "-q", "-rs", "--durations=10"]

ANSI_ESCAPE_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")

FRONTEND_INTEGRATION_KEYWORDS = {
    "sockets",
    "registry",
    "node-contracts",
    "runtime-events-contract-parity",
}

BACKEND_INTEGRATION_KEYWORDS = {
    "flow",
    "runtime",
    "stream",
    "graph",
    "manager",
    "hooks",
    "registry",
    "command",
    "policy",
    "oauth",
    "plugin",
    "e2e",
}


def _strip_ansi(text: str) -> str:
    return ANSI_ESCAPE_RE.sub("", text)


def _run_command(command: list[str]) -> dict[str, Any]:
    process = subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    output = process.stdout + process.stderr
    return {
        "command": " ".join(command),
        "exitCode": process.returncode,
        "output": output,
        "plainOutput": _strip_ansi(output),
    }


def _extract_max_count(text: str, label: str) -> int:
    matches = re.findall(rf"(\d+)\s+{label}", text)
    if not matches:
        return 0
    return max(int(value) for value in matches)


def _parse_vitest(vitest_result: dict[str, Any]) -> dict[str, Any]:
    text = vitest_result["plainOutput"]

    file_match = re.search(r"Test Files\s+(\d+)\s+passed", text)
    duration_match = re.search(r"Duration\s+(.+)", text)

    per_file_durations: list[dict[str, Any]] = []
    for match in re.finditer(
        r"✓\s+([^\s]+\.test\.(?:ts|tsx))\s+\(\s*(\d+) tests?\s*\)\s+(\d+)ms",
        text,
    ):
        per_file_durations.append(
            {
                "file": match.group(1),
                "tests": int(match.group(2)),
                "durationMs": int(match.group(3)),
            }
        )

    per_file_durations.sort(key=lambda item: item["durationMs"], reverse=True)

    return {
        "filesPassed": int(file_match.group(1)) if file_match else None,
        "testsPassed": _extract_max_count(text, "passed"),
        "testsFailed": _extract_max_count(text, "failed"),
        "testsSkipped": _extract_max_count(text, "skipped"),
        "suiteDuration": duration_match.group(1).strip() if duration_match else None,
        "topFileDurations": per_file_durations[:10],
    }


def _parse_pytest(pytest_result: dict[str, Any]) -> dict[str, Any]:
    text = pytest_result["plainOutput"]

    summary_match = re.search(
        r"(\d+)\s+passed(?:,\s+(\d+)\s+skipped)?(?:,\s+(\d+)\s+failed)?\s+in\s+([0-9.]+s)",
        text,
    )

    skip_locations: list[dict[str, Any]] = []
    skip_reason_counter: Counter[str] = Counter()
    for match in re.finditer(r"SKIPPED \[(\d+)\]\s+([^:]+:\d+):\s+(.+)", text):
        count = int(match.group(1))
        location = match.group(2)
        reason = match.group(3).strip()
        skip_locations.append(
            {
                "location": location,
                "reason": reason,
                "count": count,
            }
        )
        skip_reason_counter[reason] += count

    top_durations: list[dict[str, Any]] = []
    for match in re.finditer(r"^([0-9.]+)s\s+call\s+(.+)$", text, flags=re.MULTILINE):
        top_durations.append(
            {
                "seconds": float(match.group(1)),
                "test": match.group(2).strip(),
            }
        )

    return {
        "testsPassed": int(summary_match.group(1)) if summary_match else None,
        "testsSkipped": int(summary_match.group(2)) if summary_match and summary_match.group(2) else 0,
        "testsFailed": int(summary_match.group(3)) if summary_match and summary_match.group(3) else 0,
        "suiteDurationSeconds": summary_match.group(4) if summary_match else None,
        "skipReasons": [
            {"reason": reason, "count": count}
            for reason, count in sorted(skip_reason_counter.items(), key=lambda item: item[0])
        ],
        "skipLocations": skip_locations,
        "topDurations": top_durations[:10],
    }


def _classify_frontend_test(path: str) -> tuple[str, str]:
    stem = Path(path).stem
    for keyword in FRONTEND_INTEGRATION_KEYWORDS:
        if keyword in stem:
            return (
                "integration",
                f"Contains '{keyword}' scenario exercising coordination across flow/runtime modules.",
            )
    return (
        "unit",
        "Asserts single-module frontend behavior with isolated fixtures/mocks.",
    )


def _classify_backend_test(path: str) -> tuple[str, str]:
    if path.startswith("tests/e2e/"):
        return (
            "e2e",
            "Located in tests/e2e and validates full user workflow expectations.",
        )

    lowercase_path = path.lower()
    for keyword in sorted(BACKEND_INTEGRATION_KEYWORDS):
        if keyword in lowercase_path:
            return (
                "integration",
                f"Filename contains '{keyword}', indicating cross-module/runtime boundary coverage.",
            )

    return (
        "unit",
        "Focuses on module-level backend contracts with controlled dependency boundaries.",
    )


def _collect_inventory() -> dict[str, Any]:
    frontend_files = sorted(
        [p.relative_to(ROOT).as_posix() for p in ROOT.glob("app/**/*.test.ts")]
        + [p.relative_to(ROOT).as_posix() for p in ROOT.glob("app/**/*.test.tsx")]
    )

    backend_files = sorted(
        p.relative_to(ROOT).as_posix()
        for p in ROOT.glob("tests/**/test_*.py")
        if "tests/e2e/" not in p.relative_to(ROOT).as_posix()
    )

    e2e_files = sorted(p.relative_to(ROOT).as_posix() for p in ROOT.glob("tests/e2e/**/*.ts"))

    taxonomy_entries: list[dict[str, str]] = []

    for file_path in frontend_files:
        layer, rationale = _classify_frontend_test(file_path)
        taxonomy_entries.append(
            {
                "file": file_path,
                "surface": "frontend",
                "taxonomyLayer": layer,
                "rationale": rationale,
            }
        )

    for file_path in backend_files:
        layer, rationale = _classify_backend_test(file_path)
        taxonomy_entries.append(
            {
                "file": file_path,
                "surface": "backend",
                "taxonomyLayer": layer,
                "rationale": rationale,
            }
        )

    for file_path in e2e_files:
        taxonomy_entries.append(
            {
                "file": file_path,
                "surface": "e2e",
                "taxonomyLayer": "e2e",
                "rationale": "Legacy browser/system flow coverage kept outside Milestone-A acceptance.",
            }
        )

    counts_by_surface = {
        "frontend": len(frontend_files),
        "backend": len(backend_files),
        "e2e": len(e2e_files),
    }

    layer_counter = Counter(entry["taxonomyLayer"] for entry in taxonomy_entries)

    return {
        "countsBySurface": counts_by_surface,
        "countsByTaxonomyLayer": dict(layer_counter),
        "frontendFiles": frontend_files,
        "backendFiles": backend_files,
        "e2eFiles": e2e_files,
        "taxonomyMatrix": taxonomy_entries,
    }


def _get_git_sha() -> str | None:
    process = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if process.returncode != 0:
        return None
    return process.stdout.strip()


def main() -> None:
    inventory = _collect_inventory()

    vitest_result = _run_command(VITEST_COMMAND)
    pytest_result = _run_command(PYTEST_COMMAND)

    artifact = {
        "artifact": "milestone-a-baseline-quality-snapshot",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "gitSha": _get_git_sha(),
        "validationContractAssertions": ["VAL-TEST-001", "VAL-TEST-004", "VAL-TEST-007"],
        "classificationCriteria": {
            "unit": "Single-module contracts with isolated fixtures/mocks; no full workflow orchestration.",
            "integration": "Cross-module boundaries and runtime orchestration (flow/stream/graph/manager/registry/policy/oauth/plugin interactions).",
            "e2e": "Full-stack user workflow coverage (tests/e2e path).",
        },
        "milestoneACommandMatrix": {
            "acceptanceCommands": [
                {
                    "command": "bun run test --run",
                    "scope": "Frontend unit+integration",
                    "blockingForMilestoneA": True,
                },
                {
                    "command": "uv run pytest -q -rs --durations=10",
                    "scope": "Backend unit+integration",
                    "blockingForMilestoneA": True,
                },
            ],
            "nonBlockingCommands": [
                {
                    "command": "npx playwright test",
                    "scope": "Browser e2e",
                    "blockingForMilestoneA": False,
                    "reason": "Milestone-A acceptance is intentionally unit+integration only.",
                }
            ],
        },
        "inventory": inventory,
        "qualitySnapshot": {
            "vitest": {
                "command": vitest_result["command"],
                "exitCode": vitest_result["exitCode"],
                "parsed": _parse_vitest(vitest_result),
                "rawOutput": vitest_result["plainOutput"],
            },
            "pytest": {
                "command": pytest_result["command"],
                "exitCode": pytest_result["exitCode"],
                "parsed": _parse_pytest(pytest_result),
                "rawOutput": pytest_result["plainOutput"],
            },
        },
    }

    ARTIFACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    ARTIFACT_PATH.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {ARTIFACT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
