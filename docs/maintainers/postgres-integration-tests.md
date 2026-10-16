# PostgreSQL integration tests

The tracked backlink suite applies every PostgreSQL migration and runs the production repository against PostgreSQL 16. It checks concurrent inventory and monthly limits, admission races with edits and deletion, and the billing settlement gate.

Provide an empty, disposable database and run this command from the repository root:

```sh
TRACKED_BACKLINKS_PG_TEST_URL=postgres://postgres@127.0.0.1:5433/openseo_test \
  pnpm run test:integration:backlinks:pg
```

The suite checks that the database is empty before writing. It leaves the migrated database and fixtures in place; recreate an empty database before another run. The normal unit-test command does not run this suite.
