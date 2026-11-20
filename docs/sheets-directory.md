# Google Sheets directory demo

The private `Facilities` tab supplies the demo directory. In **Administration → Google Sheets facility directory**, click **Refresh from Google Sheets** after editing the tab. GeoCare validates the entire tab before updating the directory. It updates listings by ID and unpublishes listings removed from an earlier Google Sheets refresh. Use unique IDs and provide an evidence URL and verification date for each row. Leave the postcode blank unless you have a known code. A listing needs both coordinates to appear in nearby results.

For backend setup, enable the Google Sheets API, share the workbook with a dedicated service account as **Viewer**, and set `GOOGLE_SHEETS_SPREADSHEET_ID` to the spreadsheet ID. Use [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials) on the backend. For a host that uses a service-account key file, mount the file through the host's secret store and set `GOOGLE_APPLICATION_CREDENTIALS` to the mounted path. The app requests the `spreadsheets.readonly` scope.

You can also download the tab as CSV and use **Import directory snapshot**. This path updates rows by ID and requires coordinates on every row.

The sample postcode `ZZ-01-A01-ZZ-01` matches a demo directory location and searches immediately after **Check postcode and find nearby**. Results are ordered by straight-line distance. If the app cannot resolve an address to coordinates, select GPS, the map or manual coordinates. NIPOST Validator confirms existence without returning coordinates. Real building postcode coverage requires authorised coordinate data.

Partner signup requests require administrator review. Approve an applicant only after confirming their identity and organisational affiliation through a trusted contact. Choose their verified organisation and role, then send the single-use code through that verified channel. Recipients open **Partner signup → I have an activation code** and set their own password. Issuing a new code invalidates the previous one.

The backend uses its own database for search, operating records and authentication. Use synthetic data in the test directory.
