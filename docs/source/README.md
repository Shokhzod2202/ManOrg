# Source documents

The product owner's original documents, kept in git so every version is recorded. The Markdown
files in `docs/` are converted from these and are what the code follows; when a document changes,
the new export is committed here and the Markdown is updated in the same commit.

| File                                                                | Source                                                                                                                         | Version recorded                                                                       | Converted to    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | --------------- |
| `Organization_Management_App_-_Development_Documentation_Pack.docx` | Claude Docs "Organization Management App — Development Documentation Pack" (https://claude.ai/artifact/AfdBnotcyNtHQmTSZXLT6b) | Export dated 2026-11-08, received 2026-11-12, with sections 3.7a (DTM) and 3.10a (TOD) | `docs/SPEC.md`  |
| `F-001_Delivery-Based_Financial_Tracking.docx`                      | F-001 feature change log, approved 2026-11-12                                                                                  | Received 2026-11-12                                                                    | `docs/F-001.md` |

## History

| Date                     | Document                       | Change                                                                                                                          |
| ------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-08               | Development Documentation Pack | First version read from the Claude Docs doc; converted to `docs/SPEC.md`.                                                       |
| 2026-11-08               | Development Documentation Pack | Typo fixed in the doc and in `docs/SPEC.md` ("runs an organization's daily operations").                                        |
| 2026-11-12               | Development Documentation Pack | Added 3.7a Approximate delivery time (DTM-1 to DTM-6) and 3.10a Today's Orders and My Orders (TOD-1 to TOD-7).                  |
| 2026-11-12               | F-001                          | Approved feature change log for delivery-based financial tracking added.                                                        |
| 2026-11-12 to 2026-11-13 | Decisions                      | Product owner decisions that change or settle the spec are recorded in `docs/DECISIONS.md`, not edited into the converted spec. |

Decisions in `docs/DECISIONS.md` take precedence over these documents where they differ, until
the documents themselves are updated.
