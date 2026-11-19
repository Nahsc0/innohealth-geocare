# Verification

From the repository root, install `backend/requirements.txt` and run `python -m pytest backend/tests -q`. Tests use a disposable SQLite database by default. To check PostGIS, set `TEST_DATABASE_URL` to a fresh disposable database where the test account can create PostGIS, then rerun the same command. CI defines both jobs.

With the local API running on port 8000 and using an empty directory, run these commands from `frontend`:

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run e2e
```

Set `GEOCARE_BUILD_TEST=1` to use the production build for Playwright. Set `GEOCARE_SCREENSHOTS=1` to create annotated filenames for public-page images in `docs/screenshots`. Test databases contain synthetic fixtures. Keep production credentials out of these runs.

Playwright covers desktop and mobile navigation, Hausa switching, GPS denial, mock postcode lookup, real API registration and private tracking, unauthenticated partner access, and an interrupted request that must never produce a dispatch confirmation. Backend tests exercise provider failures and contract handling, persisted workflow records, access boundaries, authentication, rate limits and data export.

## Local verification record

19 November 2026. All 11 FastAPI tests passed using both disposable SQLite and an isolated PGlite PostgreSQL-compatible server with the PostGIS extension. The spatial run exercised the migration, radius filtering, nearest-PHC query and coverage reports through psycopg. The configured native PostgreSQL/PostGIS GitHub Actions job and managed staging infrastructure were not exercised here.

All four Vitest tests, the Next.js production build and all 18 Playwright tests passed locally. Browser evidence uses desktop Chromium and Chromium with an emulated mobile viewport. The map test intercepts tile requests and supplies test tiles. Production tile, routing and NIPOST credentials are external dependencies.
