# Contributing to Covalt

Thanks for your interest in contributing!

## Contributor License Agreement (CLA)

Before we can merge your pull request, you must sign a Contributor License Agreement.
The CLA grants SethBurkart123 the right to offer the software under additional
licenses (dual licensing) while your contribution remains open under AGPLv3.

You will be prompted to sign the CLA when you open your first pull request.

## License

All contributions are licensed under the [GNU Affero General Public License v3.0](LICENSE).

## Code guidelines

See [AGENTS.md](AGENTS.md) for coding conventions, style rules, and development commands.

## Before submitting

- Run `bun run ci:full` to verify lint, tests, and build pass.
- Fix issues at the root cause, not downstream where they manifest.
- Keep functions small (aim for <30 lines), explicit, and composable.
