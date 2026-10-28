# Bailey's Cart — R-04 v0.4 Project Lead Ratification Record

**Status: RATIFIED BY EXPLICIT PROJECT LEAD CHAT APPROVAL — REPOSITORY RECORD PENDING INTEGRATION**  
**Prepared by:** CipherMuse  
**Authority to approve:** Project Lead only  
**Workflow:** Pennington Labs Engineering Workflow v2.4  
**Gate C:** CLOSED; WP-03 ON HOLD

## Ratified action (specification baseline only)
Adopt the four identified documents below as the controlled R-04 v0.4 specification baseline, subject to Project Lead acceptance of the explicitly open technical dependencies. Ratification supersedes conflicting historical one-family-per-UID and prior R-04 candidate clauses **only where the new documents expressly amend them**; historical source files remain preserved. Ratification is **not** authorization to branch, implement, provision, test, merge, release or deploy.

## Exact document manifest (SHA-256 of these prepared local files)

| Document | SHA-256 |
|---|---|
| `API_SPEC_v0.4_CANONICAL.md` | `03718a0d63c479cee00c98c180481e98ee459784cf56d8307d9a5bcd35c7c26d` |
| `PRD_v1.0_R04_AMENDMENT.md` | `5e71e0b803ac04938314dc53d81a846c99feac3a5d6f39d4c3722b75a2d621b1` |
| `ARCHITECTURE_v1.1_R04_AMENDMENT.md` | `636161e493f6d600c07e5f3c5a9e8bfe371fa2c4259fb220b3f6fb1e19155455` |
| `BaileysCart_R04_Authorization_Error_Matrix_v0.4.md` | `1890c589bc07caa8ee934e7bcedb1addc21081bb73ceaebc2ddcad3b2c4c8498` |

## Supporting independent review evidence
- GAI R-04 v0.4 recheck: **CONDITIONAL PASS** for the earlier five-document candidate; all prior five blockers and four majors resolved at specification level.
- GAI Decisions 46–47 focused delta recheck: **PASS — Specification Delta Certified, Ready for Unified Ratification**; six additional ProofPoints PL-PP-WP03-25..30 all **NOT_RUN**.
- **Evidence boundary:** GAI subsequently issued `PASS (Integration Verified — Recommended for Project Lead Ratification)` for the prior unified four-file package, per `GAI_R04_v0.4_Unified_Ratification_Verification_Report.md`. This signature-review package changes only the authorization-matrix H1 heading from Candidate v0.3 to v0.4 and updates its SHA-256 entry. The other three specification files remain byte-identical to the GAI-reviewed manifest. The corrected matrix byte hash is newly computed here, not separately rechecked by GAI. No executed ProofPoint PASS is implied.

## Approved policy covered
- Decisions 33–47, with D42 superseding D33's multi-family ownership provision while preserving multi-family invited membership.
- D43 server-authoritative epoch, D44 pending-cancellation restore denial, D45 unentitled reservation, D46 24-hour TTL with late-payment reconciliation, D47 explicit irrevocable recovery waiver with billing/deletion safeguards.

## Explicit retained engineering dependencies / acceptance risks
- W-05: Google Play account-vs-app UID identity, single-SKU ownership behavior, purchase verification, cancellation finality, delayed settlements and refund behavior require provider evidence. One owned family per UID does not prove one subscription per Play purchaser account.
- W-01/W-02: Firebase callable transport, error mapping, confirmation-token mechanics, App Check and version compatibility require verified contract/SDK evidence.
- G-01/G-03: durable reconciliation workers, ownership-release milestone, deletion retention and operational escalation need implementation specifications and verification.
- Clear All transaction sizing, Unicode parity, local purge, and remaining open gate items retain their documented verification requirements.
- Verity ProofPoints PL-PP-WP03-01..30 remain NOT_RUN unless separately evidenced; D3/D4 execution requires authorized environments.

## Project Lead decision — APPROVED
**Decision:** RATIFY R-04 v0.4 four-document specification baseline.  
**Approved document manifest:** All four SHA-256 digests above expressly accepted by Project Lead; local `certutil -hashfile` results matched all four.  
**Accepted technical risks/dependencies:** All explicitly retained dependencies above accepted as outstanding work, not resolved or tested.  
**Approval authority:** Project Lead, Pennington Labs Dev Team.  
**Approval evidence:** Explicit Project Lead statement in this conversation (approval text reproduced below).  
**Effective event:** The Project Lead's explicit ratification message in this conversation. An independently verified wall-clock approval timestamp is not available in this record; do not fabricate one.  
**Signature mode:** Explicit written chat approval; no handwritten or cryptographic signature is claimed.  

### Verbatim Project Lead approval
> As Project Lead of Pennington Labs, I explicitly RATIFY the Bailey's Cart R-04 v0.4 four-document specification baseline and accept the exact SHA-256 manifest and tracked technical dependencies in the signature-review record. This is specification ratification only. Gate C, WP-03 implementation, branch creation, merges, builds, provisioning and deployment remain unauthorized. Prepare the approved ratification record for documentation; do not merge or implement.

## Governance and execution boundary
**Gate C: CLOSED. WP-03: ON HOLD.** No implementation, implementation branch, merge, build, cloud provisioning, test execution, deployment, or release is authorized by this ratification. No repository commit or merge is evidenced by preparation of this record. CODI, GAI, and FORGE retain their respective workflow roles. All PL-PP-WP03-01..30 ProofPoints remain NOT_RUN absent separate execution evidence.

## Document control and audit notes
- This approved record supersedes the unsigned `R04_PROJECT_LEAD_RATIFICATION_RECORD_SIGNATURE_REVIEW.md` for **approval status only**; the four specification files are unchanged.
- The GAI integration PASS applied to the prior unified package. The final authorization-matrix H1 editorial correction was not separately rechecked by GAI. Its exact corrected SHA-256 is accepted by the Project Lead.
- Archive the unsigned proposal and review reports as historical evidence. Do not overwrite earlier candidate documents or conflate ratification with Git integration.
- A separate scoped Project Lead authorization is required for documentation merge, Gate C, and any subsequent engineering execution.
