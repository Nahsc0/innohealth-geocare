# API and architecture

Next.js App Router renders the application. React client workspaces talk to FastAPI over REST, with Pydantic validation. API responses are uncached. The frontend keeps its opaque bearer token in tab session storage so a reload can restore sign-in. Tokens are hashed at rest, expire after eight hours, and are revoked on logout, account deactivation or organisation unverification. Facility search, postcode lookup, incident submission and tracking require a signed-in account. Partner workspaces also require the appropriate role.

PostgreSQL stores the facility catalog, audit events, accounts and synthetic workflows. PostGIS indexes facility geography and supports nearest and radius search. Local SQLite supports the same app workflow with Haversine distances for development. Case location, tracking-related sensitive fields, message text and referral details use application-layer Fernet encryption. Signed-in tracking also requires the case ID and a separate unguessable key. Sandbox intake accepts an optional client-generated random X-Tracking-Key header. Repeating the same payload and key after a lost response returns the existing reference. Access to cases, messages and referrals is checked server-side.

## Endpoints

The deployed API serves an interactive schema at `/docs` and OpenAPI JSON at `/openapi.json`.

| Purpose | Endpoints |
| --- | --- |
| Readiness | `GET /health` |
| Postcode lookup | `POST /v1/postcodes/lookup` with `postcode` |
| Facility directory | `GET /v1/facilities`, `GET /v1/facilities/{id}`, `POST /v1/facilities/{id}/route` |
| Sandbox registration and tracking | `POST /v1/incidents`, `POST /v1/incidents/{id}/track` with `X-Tracking-Key` |
| Sessions | `POST /v1/login`, `GET /v1/me`, `POST /v1/logout` |
| Account signup | `POST /v1/register/code`, `POST /v1/register`, `POST /v1/partner/signup`, `POST /v1/partner/activate` |
| Monthly active users | `GET /v1/admin/monthly-activity` |
| Operations | `GET /v1/ops/incidents`, `PATCH /v1/ops/incidents/{id}`, escalation, messages and ambulance administration under `/v1/ops` |
| Maternal referrals | `GET /v1/referral-destinations`, `GET/POST /v1/referrals`, `PATCH /v1/referrals/{id}` |
| Analytics | `GET /v1/analytics`, `GET /v1/analytics/export`, `GET /v1/analytics/access`, road estimate under `/v1/analytics/access`, LGA coverage and stage timing under `/v1/analytics/coverage` |
| Administration | `/v1/admin/organisations`, `/users`, `/facilities`, `/communities`, `/areas`, `/audit`, `/settings` |

Directory filters include state, category, name/LGA text, paired coordinates and radius in kilometres. The API caps directory and queue results at 100 and centroid reports at 500. Case mutations use state predicates and database transactions to avoid double assignment or out-of-order updates. Only the sandbox dispatch queue is shared between verified dispatch organisations until allocation. Responders see their own assigned incidents. Clinicians see referrals associated with their organisation, and administrator referral views omit encrypted patient detail.

Error responses use normal HTTP status codes. 401 means a session is absent or expired, 403 a role restriction, 404 a missing or out-of-scope resource, 409 a state conflict, 422 an invalid input, 429 throttling and 503 an unavailable provider. Clients should keep the sandbox safety guidance visible on request failure. Never interpret a simulated status as an operational event.
