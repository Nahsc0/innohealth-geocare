# InnoHealth GeoCare

A mobile-first Kaduna pilot by InnoHealth Africa Technologies Ltd. Individuals and approved partners can sign in to use the facility directory. It supports English and Hausa, digital-postcode validation, consent-based GPS, manual location search and MapLibre. Partner workspaces support synthetic emergency coordination, maternal referrals, administration and GIS reporting.

**Emergency operations are sandbox-only. In Nigeria, call 112 for a real emergency.** The API has no outbound dispatch connector. The directory starts empty and only publishes sourced entries that an authorised administrator has verified.

## Start locally

Install Python 3.12 and Node.js 22. Open two terminals in the repository.

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r backend/requirements.txt
$env:BOOTSTRAP_EMAIL = 'operator@example.invalid'
$env:BOOTSTRAP_PASSWORD = Read-Host -MaskInput 'Set a local password (14 characters minimum)'
$env:DATA_KEY = .venv/Scripts/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
.venv/Scripts/python -m uvicorn backend.main:app --no-access-log
```

Use a stable secret across restarts if you want to retain the encrypted case data. Set it through your local secret store. The default local database is SQLite. The hosted profile requires PostgreSQL/PostGIS and a persistent encryption key.

```powershell
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000. The API schema is at http://localhost:8000/docs. With no NIPOST key in local mode, enter the synthetic postcode `ZZ-01-A01-ZZ-01` to exercise location selection. For the PostGIS container setup, copy `.env.example` to `.env`, populate secret fields and run `docker compose up --build`. Use a URL-safe database password in this local Compose setup.

## Documentation

- [Pilot user guide](docs/user-guide.md)
- [NIPOST, NHFR, maps and data sources](docs/integrations.md)
- [Architecture and API usage](docs/api.md)
- [Account registration and monthly activity](docs/account-registration.md)
- [Staging deployment and operational runbook](docs/runbook.md)
- [Test instructions and evidence](docs/testing.md)
- [Staging status and outstanding integrations](docs/staging-status.md)
- [Desktop and mobile screenshots](docs/screenshots/index.md)
- [GitHub Pages deployment](docs/github-pages.md)
