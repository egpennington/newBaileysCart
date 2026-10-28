# Ratified specification copies

| File | Source document | Completeness code / SHA-256 | Ratification |
|---|---|---|---|
| `API_SPEC_v0.3_REV1_RATIFIED_COPY.md` | `API_SPEC_v0.3_PROPOSED_AMENDMENTS_REV1.md`, copied byte-for-byte | `8723434126` | PL ratified as API v0.3 Rev 1 after GAI Phase 4 PASS. See `docs/decisions/DECISION_REGISTER.md` R-02. |
| `R-04/API_SPEC_v0.4_CANONICAL.md` | R-04 v0.4 unified API (CipherMuse) | `03718a0d63c479cee00c98c180481e98ee459784cf56d8307d9a5bcd35c7c26d` | PL ratified as part of the R-04 v0.4 specification baseline. See register R-04. |
| `R-04/PRD_v1.0_R04_AMENDMENT.md` | R-04 PRD v1.0 amendment (CipherMuse) | `5e71e0b803ac04938314dc53d81a846c99feac3a5d6f39d4c3722b75a2d621b1` | As above. |
| `R-04/ARCHITECTURE_v1.1_R04_AMENDMENT.md` | R-04 Architecture v1.1 amendment (CipherMuse) | `636161e493f6d600c07e5f3c5a9e8bfe371fa2c4259fb220b3f6fb1e19155455` | As above. |
| `R-04/BaileysCart_R04_Authorization_Error_Matrix_v0.4.md` | R-04 Authorization & Error Matrix v0.4 (CipherMuse) | `1890c589bc07caa8ee934e7bcedb1addc21081bb73ceaebc2ddcad3b2c4c8498` | As above. |

- The v0.3 copy is unmodified. Its header ("REVISED PROPOSAL … NOT AN APPROVED API BASELINE") predates ratification. The decision register is the record of its approved status.
- The v0.3 copy is a delta to API v0.2. It is not a canonical merged API document. Canonical incorporation was ratified as R-04 v0.4 (`R-04/API_SPEC_v0.4_CANONICAL.md`; register R-04).
- `API_SPEC_v0.3_RATIFIED_ADDENDUM_P4D10_P4D11_v0.1.md` (register R-03) is not copied here. CODI was not authorized to read it, and nothing is committed without being read first.
- `R-04/` holds:
  - the four ratified R-04 v0.4 documents
  - the approved ratification record (`R04_PROJECT_LEAD_RATIFICATION_RECORD_APPROVED.md`)
  - historical candidates, GAI review reports and review packages, preserved unmodified
- Files in `R-04/` whose headers read "NOT RATIFIED" or "CANDIDATE" predate ratification. This includes the four ratified documents and `README_REVIEW_FIRST.md`. The ratification record is authoritative for their status.
- The four ratified files are byte-identical to the ratified SHA-256 manifest. Verify them against the committed blob, for example `git cat-file blob HEAD:docs/specs/R-04/API_SPEC_v0.4_CANONICAL.md | sha256sum`. A Windows working-copy checkout may change line endings.
- R-04 ratification is specification-only. Gate C remains CLOSED and WP-03 remains ON HOLD.
