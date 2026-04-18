# Contributing to AINPI

Thanks for your interest. AINPI is an open-source audit of the CMS National Provider Directory. Contributions land in three shapes:

1. **Data quality bug reports** — a finding disagrees with the source artifact, a check produces false positives, a query is wrong. File an issue using the **Data quality bug** template.
2. **New metric proposals** — you want a new hypothesis (H23+) added to the check catalog. File an issue using the **New metric proposal** template. Propose the null hypothesis, the data source, and the computation before any code lands.
3. **Code contributions** — bug fixes, chart improvements, pipeline work, test coverage. Open a PR using the PR template. Link to the issue it closes.

## Ground rules

- Every finding must be reproducible from a clean checkout. If you add a check, add the SQL / script that produces it and a test with a fixture.
- Methodology changes are versioned. If you change how a check is computed, bump the methodology version in `docs/methodology/index.md` and note the change in the finding's page.
- No named-and-shamed leaderboards in public findings without an explicit data-backed rationale and peer review. The posture is mechanics, not blame.
- Commit messages describe the mechanic changed, not the motivation. Commit message scope = the diff.

## Development

```bash
# frontend
cd frontend
npm install
npm run dev

# tests
npm run lint
npm run test
npm run test:e2e
```

Before opening a PR, run `npm run lint && npm run test` locally. CI runs the same commands.

## Pre-registration

Hypotheses in the check catalog are pre-registered. If you want to add a metric, submit the proposal issue first so the null and methodology are public **before** results drop. This is the project's trust contract.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Please do not open public issues for vulnerabilities.

## Code of conduct

This project follows the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
