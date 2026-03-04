#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any

DEFAULT_RUFF_COMMAND = [
    "uv",
    "run",
    "--group",
    "dev",
    "ruff",
    "check",
    "backend/",
    "tests/",
    "main.py",
    "--output-format",
    "json",
]
TOP_LIMIT = 10


def _rule_family(code: str) -> str:
    prefix: list[str] = []
    for char in code:
        if char.isalpha():
            prefix.append(char)
            continue
        break
    return "".join(prefix) or code


def _relative_path(raw_path: str, cwd: Path) -> str:
    path = Path(raw_path)
    if not path.is_absolute():
        return path.as_posix()
    try:
        return path.relative_to(cwd).as_posix()
    except ValueError:
        return path.as_posix()


def _to_ranked(counter: Counter[str], limit: int = TOP_LIMIT) -> list[dict[str, Any]]:
    return [
        {"name": name, "count": count}
        for name, count in counter.most_common(limit)
    ]


def _build_inventory(findings: list[dict[str, Any]], cwd: Path) -> dict[str, Any]:
    by_rule = Counter[str]()
    by_family = Counter[str]()
    by_file = Counter[str]()

    for finding in findings:
        code = finding.get("code", "UNKNOWN")
        by_rule[code] += 1
        by_family[_rule_family(code)] += 1
        by_file[_relative_path(finding.get("filename", "UNKNOWN"), cwd)] += 1

    top_rules = _to_ranked(by_rule)
    top_families = _to_ranked(by_family)
    top_files = _to_ranked(by_file)

    import_placement_debt = by_rule.get("PLC0415", 0) + by_rule.get("E402", 0)
    typing_modernization_debt = (
        by_rule.get("UP045", 0)
        + by_rule.get("UP006", 0)
        + by_rule.get("UP035", 0)
    )

    return {
        "artifact": "lint-python-debt-inventory",
        "targets": ["backend/", "tests/", "main.py"],
        "totalViolations": len(findings),
        "topRules": top_rules,
        "topRuleFamilies": top_families,
        "topFiles": top_files,
        "decision": {
            "strategy": "separate-reporting-from-required-gate",
            "rationale": (
                "Ruff failures are pre-existing debt and currently non-required for merge; "
                "track them as advisory inventory while required fail-closed contexts stay "
                "lint/vitest/pytest/playwright."
            ),
            "requiredMergeContexts": ["lint", "vitest", "pytest", "playwright"],
        },
        "triagePlan": [
            {
                "priority": "P1",
                "scope": "Import placement/order debt (PLC0415 + E402)",
                "currentCount": import_placement_debt,
                "nextStep": "Normalize imports in top hotspot files, then enforce with small batched PRs.",
            },
            {
                "priority": "P2",
                "scope": "Typing modernization debt (UP045/UP006/UP035)",
                "currentCount": typing_modernization_debt,
                "nextStep": "Apply safe codemods for Optional/List/Dict modernization and rerun targeted tests.",
            },
            {
                "priority": "P3",
                "scope": "Correctness/style leftovers (F821/F401/F811/F841/E501/UP028/I001)",
                "currentCount": len(findings)
                - import_placement_debt
                - typing_modernization_debt,
                "nextStep": "Clean undefined/unused symbols first, then tighten formatting/style findings.",
            },
        ],
    }


def _to_markdown(inventory: dict[str, Any], advisory: bool) -> str:
    title = "## Lint Python (Ruff) Debt Summary"
    mode = "advisory (non-blocking)" if advisory else "strict (blocking)"
    lines = [
        title,
        "",
        f"- Mode: **{mode}**",
        f"- Total violations: **{inventory['totalViolations']}**",
        f"- Decision: **{inventory['decision']['strategy']}**",
        f"- Required merge contexts unchanged: `{', '.join(inventory['decision']['requiredMergeContexts'])}`",
        "",
        "### Top rule families",
        "| Family | Count |",
        "| --- | ---: |",
    ]
    for item in inventory["topRuleFamilies"]:
        lines.append(f"| {item['name']} | {item['count']} |")

    lines.extend(["", "### Top files", "| File | Count |", "| --- | ---: |"])
    for item in inventory["topFiles"]:
        lines.append(f"| `{item['name']}` | {item['count']} |")

    lines.append("")
    lines.append("### Triage plan")
    for plan in inventory["triagePlan"]:
        lines.append(
            f"- **{plan['priority']}** {plan['scope']}: {plan['currentCount']} findings. {plan['nextStep']}"
        )

    return "\n".join(lines)


def _run_ruff() -> tuple[int, list[dict[str, Any]]]:
    process = subprocess.run(
        DEFAULT_RUFF_COMMAND,
        capture_output=True,
        text=True,
    )

    if process.returncode not in (0, 1):
        if process.stdout:
            print(process.stdout)
        if process.stderr:
            print(process.stderr, file=sys.stderr)
        return process.returncode, []

    stdout = process.stdout.strip() or "[]"
    findings = json.loads(stdout)
    return process.returncode, findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate an advisory Ruff debt inventory report")
    parser.add_argument(
        "--inventory",
        type=Path,
        default=Path("tests/artifacts/lint-python-debt-inventory.json"),
        help="Path to write the debt inventory JSON",
    )
    parser.add_argument(
        "--summary",
        type=Path,
        default=None,
        help="Optional markdown summary output path",
    )
    parser.add_argument(
        "--advisory",
        action="store_true",
        help="Exit 0 when Ruff exits with 1 (lint violations present)",
    )

    args = parser.parse_args()

    ruff_exit, findings = _run_ruff()
    if ruff_exit not in (0, 1):
        return ruff_exit

    cwd = Path.cwd()
    inventory = _build_inventory(findings, cwd)

    args.inventory.parent.mkdir(parents=True, exist_ok=True)
    args.inventory.write_text(json.dumps(inventory, indent=2) + "\n")

    markdown = _to_markdown(inventory, advisory=args.advisory)
    if args.summary is not None:
        args.summary.parent.mkdir(parents=True, exist_ok=True)
        args.summary.write_text(markdown + "\n")

    github_step_summary = Path(path) if (path := os.getenv("GITHUB_STEP_SUMMARY")) else None
    if github_step_summary is not None:
        with github_step_summary.open("a", encoding="utf-8") as handle:
            handle.write(markdown + "\n")

    print(markdown)

    if ruff_exit == 1 and args.advisory:
        print(
            "::warning::Pre-existing lint-python debt detected. See lint-python debt artifact for triage details."
        )
        return 0

    return ruff_exit


if __name__ == "__main__":
    raise SystemExit(main())
