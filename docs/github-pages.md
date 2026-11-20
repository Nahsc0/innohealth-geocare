# GitHub Pages deployment

Target a dedicated `Nahsc0/innohealth-geocare` project repository. The default project URL is `https://nahsc0.github.io/innohealth-geocare/`. GitHub Pages serves the frontend static export. The FastAPI service and PostgreSQL/PostGIS run on separate managed services.

1. Provision an authorised PostgreSQL database with PostGIS and a persistent FastAPI service with HTTPS. Follow [the staging runbook](runbook.md) for database roles, migration, encryption keys and account bootstrap.
2. Set `FRONTEND_ORIGINS=https://nahsc0.github.io` in the API environment. Browsers send the origin without the repository path. Leave dispatch disabled and use synthetic records.
3. Push the project to its dedicated repository. Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**.
4. Set `GEOCARE_API_URL` under **Settings → Secrets and variables → Actions → Variables**, or commit the verified public HTTPS API base URL in `deploy/pages-api-url.txt`. Use the base URL without `/v1`. Set `GEOCARE_TILE_URL` to the approved public map tile template if available. Keep database, encryption and provider secrets in the API host.
5. Configure the [Apps Script account registry](account-registration.md) on the hosted backend. Sign in as an administrator and click **Refresh from Google Sheets** to load and validate the Facilities tab. The Pages workflow checks the Google Sheet, email permission, loaded directory, API health, CORS and whether the directory requires sign-in. Open the URL from the deployment job and smoke-test individual and partner signup with synthetic data.

The static route for facility details uses `/facilities/?id=...` so newly verified facilities can be opened without rebuilding the frontend. The Pages build uses the base path returned by GitHub.

The Kaduna demo includes Google Maps satellite embeds generated using Google Maps' sharing menu. The connected directory can open any mapped facility in Google Maps satellite view. To also embed satellite imagery for connected facilities, set `GEOCARE_GOOGLE_MAPS_EMBED_KEY` to a browser key restricted to the Pages origin and the Maps Embed API. [Google Maps Embed API setup](https://developers.google.com/maps/documentation/embed/quickstart)

References [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) and [Next.js static export](https://nextjs.org/docs/app/guides/static-exports).

While both API URL settings are unset, pushes to `main` publish the labelled demo. Choose the preview input when running the workflow manually to publish the demo on demand. Select **Sign in to demo**, then **Use sample postcode** (`ZZ-01-A01-ZZ-01`) for three synthetic Kaduna results. The demo uses a bundled copy of the Facilities tab snapshot and handles search in the browser. Once an API URL is configured, pushes to `main` publish a connected build after the readiness checks pass.

For a short, synthetic demonstration, the Render Blueprint provisions a free web service and an internal-only PostGIS database in Frankfurt. It runs the existing migrations on container start because free instances lack a pre-deploy command. The database expires after 30 days. Enter initial administrator credentials directly in Render, then remove the bootstrap variables after confirming sign-in. Use a dedicated migration identity and backed-up database for longer-lived environments. [Render free-tier limits](https://render.com/docs/free)
