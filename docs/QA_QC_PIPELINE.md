# QA/QC Pipeline

This repository now includes a lightweight world-class-style quality gate that combines:

- automated unit-style checks for the new QA/QC harness
- system smoke tests against the factory server
- offline report store regression checks
- employee XLSX round-trip validation

## Commands

- `yarn test`
- `yarn qa:qc`
- `yarn test:system`
- `yarn test:offline-store`
- `yarn verify:employee-xlsx`

## CI behavior

The GitHub workflow runs the QA/QC pipeline for every push and pull request. Releases only publish after the QA/QC job passes.

## Suggested next steps

1. Add linting with ESLint and Prettier.
2. Add contract tests for API endpoints.
3. Add a performance budget and Lighthouse check.
4. Publish a quality badge in the README.
