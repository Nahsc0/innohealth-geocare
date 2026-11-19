# Google Sheets directory demo

The private Facilities tab is the source for the synthetic demo directory. Download that tab as CSV and import it under **Administration → Google Sheets directory import**. The app validates all rows before saving them. An import updates records by ID and leaves absent IDs alone. Blank postcode values are allowed. Coordinates and the source and verification date are required.

The sample postcode `ZZ-01-A01-ZZ-01` matches a demo directory location and searches immediately after **Check postcode and find nearby**. Results are ordered by straight-line distance. If the app cannot resolve an address to coordinates, select GPS, the map or manual coordinates. NIPOST Validator confirms existence without returning coordinates. Real building postcode coverage requires authorised coordinate data.

Partner signup requests require administrator review. Approve an applicant only after confirming their identity and organisational affiliation through a trusted contact. Choose their verified organisation and role, then send the single-use code through that verified channel. Recipients open **Partner signup → I have an activation code** and set their own password. Issuing a new code invalidates the previous one.

The Sheet is a private source for imported facility snapshots. The sandbox backend uses its normal database for operating records and authentication. Changes in Sheets appear after the next CSV import. Use synthetic data in this demo.
