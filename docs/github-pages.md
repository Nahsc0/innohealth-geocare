# GitHub Pages deployment

Target a dedicated `Nahsc0/innohealth-geocare` project repository. The default project URL is `https://nahsc0.github.io/innohealth-geocare/`. GitHub Pages serves the frontend static export. The FastAPI service and PostgreSQL/PostGIS run on separate managed services.

1. Provision an authorised PostgreSQL database with PostGIS and a persistent FastAPI service with HTTPS. Follow [the staging runbook](runbook.md) for database roles, migration, encryption keys and account bootstrap.
2. Set `FRONTEND_ORIGINS=https://nahsc0.github.io` in the API environment. Browsers send the origin without the repository path. Leave dispatch disabled and use synthetic records.
3. Push the project to its dedicated repository. Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**.
4. Under **Settings → Secrets and variables → Actions → Variables**, set `GEOCARE_API_URL` to the HTTPS API base URL with no trailing `/v1`. Set `GEOCARE_TILE_URL` to the approved public map tile template if available. Keep database, encryption and provider secrets in the API host.
5. Run **Deploy GeoCare to GitHub Pages** manually. The workflow checks API health, dispatch mode, CORS and the public facility directory before publishing. Open the URL from the deployment job and smoke-test the public and partner flows with synthetic data.

The static route for facility details uses `/facilities/?id=...` so newly verified facilities can be opened without rebuilding the frontend. The Pages build uses the base path returned by GitHub.

References [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) and [Next.js static export](https://nextjs.org/docs/app/guides/static-exports).

The optional workflow preview input publishes a labelled frontend-only build while the API is being provisioned. This mode disables server requests and keeps the application's emergency assistance notice visible. Run the workflow with the preview input off to verify and publish a connected build.

For a short, synthetic demonstration, the Render Blueprint provisions a free web service and an internal-only PostGIS database in Frankfurt. It runs the existing migrations on container start because free instances lack a pre-deploy command. The database expires after 30 days. Enter initial administrator credentials directly in Render, then remove the bootstrap variables after confirming sign-in. Use a dedicated migration identity and backed-up database for longer-lived environments. [Render free-tier limits](https://render.com/docs/free)
