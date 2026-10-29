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

## WP-03 Slice 1: API Amendment A1

| File (`R-04/`) | Status | SHA-256 |
|---|---|---|
| `API_SPEC_v0.4_AMENDMENT_WP03_S1_PROPOSED_v0.2.md` | **Ratified** by the PL as API Amendment A1 v0.2, **WP-03 Slice 1 only**. Its "PROPOSED" header predates ratification and is left unedited to keep the hash fixed. | `616bd0eb75b191aa6dc9b7157bf07557ad9067c6025870d2b874a794b3e30572` |
| `API_AMENDMENT_A1_v0.2_RATIFICATION_RECORD_v1.1.md` | **Authoritative** ratification record (adds R-1 and F-3/HB-3) | — |
| `API_AMENDMENT_A1_v0.2_CLARIFICATION_R1_v1.0.md` | PL-approved interpretive clarification of §A1.6 (replay precedence). No API or runtime change. | — |
| `WP03_S1_HARDENING_BACKLOG_v1.1.md` | Current hardening backlog (HB-1, HB-2, HB-3), mandatory before any additional family-record writer. Not implemented. | — |
| `API_SPEC_v0.4_AMENDMENT_WP03_S1_PROPOSED_v0.1.md` | **Historical. Superseded by v0.2; not ratified; no normative force.** Kept unmodified. | `9982238fa1bed67a6d70edc8150c1b087141b3c39c9cf03ae0edd3b689c48529` |
| `API_AMENDMENT_A1_v0.2_RATIFICATION_RECORD_v1.0.md` | **Historical.** Superseded by record v1.1. Kept unmodified. | — |
| `WP03_S1_F1_F2_HARDENING_BACKLOG_v1.0.md` | **Historical.** Superseded by backlog v1.1. Kept unmodified. | — |

- A1 v0.2 amends the R-04 v0.4 API for Slice 1. The four R-04 v0.4 documents above are unchanged.
