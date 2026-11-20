# GeoCare registration and monthly activity

Guests can sign in, register as individuals, or apply for a partner account. Individuals receive a six-digit code by email, enter their profile and a password, and can use the app after verification. Each code expires in 10 minutes. GeoCare allows up to five verification attempts per code and waits one minute before resending. An approved partner activates the account with a single-use code delivered through a verified contact channel. Use a distinct work email when applying for partner access.

Administration shows unique active accounts per UTC calendar month. A successful sign-in or authenticated request adds the account once to that month. A repeat visit makes no difference to that month's count. Reports contain aggregate totals only.

Successful hosted sign-ins are also exported to the workbook's `Sign-in activity` tab. Each row contains an event ID, account ID, role and UTC sign-in time. The API retries a failed export from its database queue without blocking sign-in. The demo runs in the browser and contributes no activity to the workbook.

## Configure the private Apps Script registry

1. Open the private credential workbook and confirm the `Account credentials` and `Sign-in activity` header orders match [Code.gs](../scripts/apps-script/Code.gs). Keep workbook and script editor access limited to registration administrators.
2. In the bound Apps Script project, save `Code.gs`. In **Project settings → Script properties**, set `SPREADSHEET_ID` to the workbook ID. Generate a random 32-byte secret and store its hex text as `REGISTRY_SECRET`.
3. Deploy as a web app with **Execute as Me** and **Who has access → Anyone** so FastAPI can reach it. The script verifies HMAC signatures, timestamps and nonces before opening the workbook or sending a code. The workbook remains private. Review the Google authorization screen for Sheets and MailApp access before consenting. The deployment uses the owner's email quota. [Google Apps Script web apps](https://developers.google.com/apps-script/guides/web) [MailApp reference](https://developers.google.com/apps-script/reference/mail/mail-app)
4. Put the `/exec` URL in `APPS_SCRIPT_REGISTRY_URL` and the same secret in `APPS_SCRIPT_REGISTRY_SECRET` on the backend host. Configure a persistent `DATA_KEY` through the host's secret manager before registering accounts. Preserve this encryption key across deployments and backups. Run database migrations before starting the updated API.
5. Test a synthetic individual registration and approved partner activation. Check for the corresponding encrypted entries in the Sheet. Verify sign-out and returning sign-in, and check the active-user count in Administration.

In **Administration**, select **Refresh from Google Sheets** to load the `Facilities` tab through the same signed Apps Script connection. The optional `GOOGLE_SHEETS_SPREADSHEET_ID` setting uses the Sheets API and application default credentials for deployments that manage directory access separately.

Hosted self-service registration and partner activation require the Apps Script settings. Local tests can set `GEOCARE_DEV_MAILBOX` to an ignored file and read test messages there. Existing accounts keep their original password verifier in the database. For new Sheet-backed accounts, FastAPI stores the Argon2id password verifier encrypted with `DATA_KEY` in the Sheet. FastAPI stores encrypted demographic profiles in its operating database alongside the email verification timestamp, sign-in identifiers, roles, sessions and usage records. The registration endpoint stores only a keyed verifier for each code, and the mailing endpoint receives the recipient and code for delivery.
