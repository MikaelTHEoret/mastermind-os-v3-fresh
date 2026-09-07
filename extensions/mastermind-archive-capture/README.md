# Mastermind Archive Capture

This Manifest V3 Chrome extension is the browser-side evidence acquisition arm for Mastermind genealogy.

- It pairs explicitly with the local Genealogy console.
- NLI page ranges and bounded IIIF manifest ranges are fetched by the background service worker without opening or driving visible tabs.
- The first IIIF adapter supports Morbihan's public manifest catalogue while reusing the user's normal Chrome archive session for permitted originals.
- Morbihan viewer links are converted to their IIIF manifest automatically; the operator does not need to discover or edit the hidden `/manifest` URL.
- Every IIIF start indexes the complete manifest first; only the explicitly bounded image range is then acquired.
- Ordered library mode stores each original in manifest order and creates a deliberately name-free date/layout/handwriting index for later calibration.
- A persistent watchdog resumes an interrupted background step and retries transient page failures up to three times before stopping with a visible reason.
- Fast indexing uses only bounded IIIF or viewer renditions to extract page type, visible years, name tokens, and place terms; the temporary image is discarded and full transcription remains opt-in.
- Overnight structured extraction reads every visible event and participant from full temporary imagery, stores spreadsheet-like event/person/relationship rows plus the retrieval URL, and discards the image unless it was separately selected as evidence.
- Capture mode sends selected originals to the local content-addressed archive; overnight extraction mode never persists its temporary source image.
- A generic manual action captures the largest visible image on another archive site after Chrome grants that site permission.
- Structured rows remain unreviewed leads until a human or proof workflow validates them; graph proposals never bypass that review boundary.

Load this directory with **Chrome → Extensions → Developer mode → Load unpacked**, then click **Connect to Mastermind** and approve the pending client in the local Genealogy tab.
