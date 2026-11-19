# Staging status

The application is configured for synthetic testing. The runtime has no live dispatch connector. No external staging target was configured in this workspace.

| Item | Current state | What is needed |
| --- | --- | --- |
| NIPOST validation | Official Validator contract implemented. Local mock and simulated upstream tests available. | Organisation test key and credential-backed smoke test. For permitted coordinate lookup and reverse geocoding, obtain the approved endpoint, response schema and licence. |
| Verified facilities | Verification UI and API, published directory and near-me search. | Authorised NHFR or Kaduna facility data and independent confirmation of contacts, hours, services and locations. |
| GIS access | Facility distribution, LGA coverage and density reports, small-cell suppression, nearest-PHC estimates and configurable road routing. | Verified community coverage and sourced LGA population and area inputs to populate density and geographic inequality reports. Current measures describe the loaded records. |
| Incident and referral intelligence | Sandbox status and category counts, assigned responder actions, audit log, filtered queues, sandbox stage timing and CSV. | Approved and privacy-reviewed inputs for geographic incident-pattern reporting and operational performance analysis. |
| Hosting and providers | Netlify and container definitions, application and PostGIS migrations, CI and runbook. | Authorised source repository and staging accounts, database credentials, secrets, private staging access and approved tile and road providers. |
| Emergency partners | Organisation and role administration for sandbox exercises. | Verified response partners, agreed dispatch and escalation procedures, legal and operational approvals and separately accepted live integration. |
| Privacy and language | Draft sandbox notices, English and Hausa public copy. | Controller-approved policies, DPIA, notice contacts, Hausa editorial review, operator validation and security acceptance. |
