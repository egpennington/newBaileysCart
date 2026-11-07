/**
 * D2: families.prepareLifecycleConfirmation (A2-D4) against the Firestore emulator, with its consumers
 * families.close and families.waiveRecovery. PL-PP-WP03-32 D2: authorization, eligibility, issuance and
 * storage, TTL, family-wide supersession, the fail-closed same-opId retry, races, the sprint throttle
 * and recent-sign-in policies, the local-only barrier and a storage/log audit for the plaintext token.
 */
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { before, describe, test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { runCallable } from "../../src/callable/adapter.js";
import { DomainError } from "../../src/contract/errors.js";
import { CONFIRMATION_TOKEN_TTL_MS, ISSUANCE_WINDOW_MS } from "../../src/domain/confirmation.js";
import { RECOVERY_WINDOW_MS } from "../../src/domain/family.js";
import { processCancellationCase } from "../../src/workers/lifecycleWorkers.js";
import { clearFirestore, db, expectDomainError, newOpId } from "../support/emulator.js";
import { T0, World, familyDoc, snapshotState, verified } from "../support/lifecycle.js";

const STRESS = Number(process.env["WP03_STRESS_ITERATIONS"] ?? 50);
const PARALLEL = 5;
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
before(clearFirestore);

async function pointer(familyId: string): Promise<Record<string, unknown> | undefined> {
  return (await db.doc(`lifecycleConfirmations/${familyId}`).get()).data();
}
async function tokensFor(familyId: string): Promise<number> {
  return (await db.collection("confirmationTokens").where("familyId", "==", familyId).get()).size;
}
/** Everything a rejected preparation must leave untouched, including the issuer's own records. */
async function issuerState(uid: string, familyId: string): Promise<string> {
  const idem = await db.collection("idempotency").where("actorUid", "==", uid).get();
  return JSON.stringify([
    await snapshotState(uid, familyId),
    await pointer(familyId),
    await tokensFor(familyId),
    idem.docs.map((d) => [d.id, d.data()]),
  ]);
}
function closeWith(familyId: string, token: string, familyEpoch = 1, opId = newOpId()) {
  return { apiVersion: "v0.4", opId, familyId, familyEpoch, confirmationToken: token };
}
async function allDocsText(): Promise<string> {
  const out: unknown[] = [];
  for (const c of ["confirmationTokens", "lifecycleConfirmations", "idempotency", "families", "closureCases", "users", "ownershipReleaseAudits", "familyBilling"]) {
    const snap = await db.collection(c).get();
    out.push(snap.docs.map((d) => [d.ref.path, d.data()]));
  }
  return JSON.stringify(out);
}

describe("issuance and storage (PL-PP-WP03-32: success, digest-only, binding)", () => {
  test("CLOSE: A1 envelope, 43-char base64url token, expiresAt = issuedAt + 900 s, digest-only record", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    const req = w.prepareReq(familyId, "CLOSE");
    const res = await w.prepare(w.fresh(uid), req);

    assert.equal(res.apiVersion, "v0.4");
    assert.equal(res.status, "COMMITTED");
    assert.equal(res.opId, req.opId);
    assert.equal(res.serverTime, new Date(T0).toISOString());
    assert.deepEqual(Object.keys(res.data).sort(), ["action", "confirmationToken", "expiresAt", "familyEpoch", "familyId"]);
    assert.match(res.data.confirmationToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(res.data.confirmationToken, "base64url").length, 32);
    assert.equal(res.data.expiresAt, new Date(T0 + 900_000).toISOString());
    assert.deepEqual([res.data.action, res.data.familyId, res.data.familyEpoch], ["CLOSE", familyId, 1]);

    const hash = sha(res.data.confirmationToken);
    const rec = (await db.doc(`confirmationTokens/${hash}`).get()).data();
    assert.ok(rec, "token stored under its SHA-256 digest");
    assert.equal(rec["uid"], uid);
    assert.equal(rec["familyId"], familyId);
    assert.equal(rec["action"], "families.close");
    assert.equal(rec["familyEpoch"], 1);
    assert.equal((rec["issuedAt"] as Timestamp).toMillis(), T0);
    assert.equal((rec["expiresAt"] as Timestamp).toMillis(), T0 + CONFIRMATION_TOKEN_TTL_MS);
    assert.equal(rec["consumedAt"], null);
    assert.equal(rec["issuedByOpId"], req.opId);
    const p = await pointer(familyId);
    assert.equal(p?.["activeTokenHash"], hash);
    assert.equal(p?.["activeOpId"], req.opId);
    assert.equal(p?.["ownerUid"], uid);

    const idem = await db.collection("idempotency").where("opId", "==", req.opId).get();
    assert.equal(idem.size, 1);
    assert.equal(idem.docs[0]?.get("responseJson"), undefined, "no replayable response is stored");
    assert.equal(idem.docs[0]?.get("tokenHash"), hash);
    assert.ok(!(await allDocsText()).includes(res.data.confirmationToken), "plaintext absent from every server record");

    // No family, membership, billing, lifecycle or epoch change.
    const fam = await familyDoc(familyId);
    assert.equal(fam["lifecycleState"], "ACTIVE");
    assert.equal(fam["familyEpoch"], 1);
    assert.equal(fam["lifecycleRevision"] ?? 0, 0);

    // The prepared token is consumed by families.close, atomically with the lifecycle commit.
    const closeReq = closeWith(familyId, res.data.confirmationToken);
    const closed = await w.close(verified(uid), closeReq);
    assert.equal(closed.data.lifecycleState, "CLOSING");
    const after = (await db.doc(`confirmationTokens/${hash}`).get()).data();
    assert.equal((after?.["consumedAt"] as Timestamp).toMillis(), T0);
    assert.equal(after?.["consumedByOpId"], closeReq.opId);
    assert.equal((await pointer(familyId))?.["activeTokenHash"], null, "consumption clears the pointer");
    // D-1: the committed replay returns the original result and consumes nothing further.
    assert.deepEqual(await w.close(verified(uid), { ...closeReq }), closed);
    // The consumed token cannot authorize another action under a fresh opId.
    await w.restore(verified(uid), w.restoreReq(familyId));
    await expectDomainError(w.close(verified(uid), closeWith(familyId, res.data.confirmationToken, 2)), "CONFIRMATION_REQUIRED");
    // D-1 after an epoch advance: the original close replay is still returned unchanged.
    assert.deepEqual(await w.close(verified(uid), { ...closeReq }), closed);
  });

  test("WAIVE_RECOVERY in CLOSING and in CLOSURE_PENDING_BILLING: issued, then consumed by waiveRecovery", async () => {
    const w = new World();
    const t = await w.trialFamily("wv");
    await w.closed(t.uid, t.familyId);
    const tok = await w.prepared(t.uid, t.familyId, "WAIVE_RECOVERY");
    const rec = (await db.doc(`confirmationTokens/${sha(tok)}`).get()).data();
    assert.equal(rec?.["action"], "families.waiveRecovery");
    const res = await w.waive(verified(t.uid), closeWith(t.familyId, tok));
    assert.equal(res.data.disposition, "DELETION_PENDING");

    const p = await w.paidFamily("wvp");
    const caseId = await w.closed(p.uid, p.familyId);
    const ptok = await w.prepared(p.uid, p.familyId, "WAIVE_RECOVERY");
    assert.equal((await w.waive(verified(p.uid), closeWith(p.familyId, ptok))).data.disposition, "WAIVER_RECORDED_PENDING_BILLING");
    assert.equal(await processCancellationCase({ db, clock: w.clock, provider: w.provider }, caseId), "DELETION_PENDING");
  });

  test("tokens are distinct across issuances (CSPRNG source, 32 bytes)", async () => {
    const w = new World();
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const { uid, familyId } = await w.trialFamily(`rnd${i}`);
      seen.add(await w.prepared(uid, familyId, "CLOSE"));
    }
    assert.equal(seen.size, 5);
  });
});

describe("authorization and eligibility: safe failures, nothing written", () => {
  test("member, former member, stranger, missing family, unverified, stale or missing auth_time", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily();
    const member = await w.member(familyId);
    const former = await w.member(familyId, "former");
    await db.doc(`families/${familyId}/members/${former}`).update({ state: "REVOKED" });
    await db.doc(`users/${former}/memberships/${familyId}`).update({ state: "REVOKED" });
    const stranger = (await w.trialFamily("str")).uid;
    const before = await issuerState(uid, familyId);

    for (const who of [member, former, stranger]) {
      for (const action of ["CLOSE", "WAIVE_RECOVERY"] as const) {
        await expectDomainError(w.prepare(w.fresh(who), w.prepareReq(familyId, action)), "OWNER_REQUIRED");
      }
    }
    await expectDomainError(w.prepare(w.fresh(uid), w.prepareReq("missingFamily0000000", "CLOSE")), "NOT_FOUND");
    await expectDomainError(w.prepare({ uid, emailVerified: false, authTimeSeconds: Math.floor(T0 / 1000) }, w.prepareReq(familyId, "CLOSE")), "EMAIL_VERIFICATION_REQUIRED");
    await expectDomainError(w.prepare(verified(uid), w.prepareReq(familyId, "CLOSE")), "UNAUTHENTICATED");
    await expectDomainError(w.prepare(w.fresh(uid, 5 * 60_000), w.prepareReq(familyId, "CLOSE")), "UNAUTHENTICATED");
    // Client-supplied claims in the body cannot stand in for the token's auth_time or the epoch.
    await expectDomainError(w.prepare(verified(uid), { ...w.prepareReq(familyId, "CLOSE"), auth_time: Math.floor(T0 / 1000) }), "UNAUTHENTICATED");
    await expectDomainError(w.prepare(w.fresh(uid), { ...w.prepareReq(familyId, "CLOSE"), familyEpoch: 1 }), "VALIDATION_FAILED");
    // Fresh sign-in 1 s inside the limit still works afterwards.
    assert.equal(await issuerState(uid, familyId), before, "no record of any kind for a denied preparation");
    await w.prepare(w.fresh(uid, 5 * 60_000 - 1000), w.prepareReq(familyId, "CLOSE"));
  });

  test("ineligible lifecycle states return the target command's own code and issue nothing", async () => {
    const w = new World();
    const a = await w.trialFamily("el");
    await expectDomainError(w.prepare(w.fresh(a.uid), w.prepareReq(a.familyId, "WAIVE_RECOVERY")), "CLOSURE_NOT_ELIGIBLE_FOR_WAIVER");
    await w.closed(a.uid, a.familyId);
    let before = await issuerState(a.uid, a.familyId);
    await expectDomainError(w.prepare(w.fresh(a.uid), w.prepareReq(a.familyId, "CLOSE")), "FAMILY_CLOSING");
    assert.equal(await issuerState(a.uid, a.familyId), before);

    const p = await w.paidFamily("elp");
    await w.closed(p.uid, p.familyId);
    await expectDomainError(w.prepare(w.fresh(p.uid), w.prepareReq(p.familyId, "CLOSE")), "FAMILY_CLOSURE_PENDING");

    const r = await db.collection("families").add({
      ownerUid: a.uid,
      lifecycleState: "UNENTITLED_AWAITING_PAYMENT",
      familyEpoch: 1,
      reservationCreatedAt: Timestamp.fromMillis(T0),
      reservationExpiresAt: Timestamp.fromMillis(T0 + 86_400_000),
    });
    await expectDomainError(w.prepare(w.fresh(a.uid), w.prepareReq(r.id, "CLOSE")), "UNENTITLED_AWAITING_PAYMENT");
    await expectDomainError(w.prepare(w.fresh(a.uid), w.prepareReq(r.id, "WAIVE_RECOVERY")), "CLOSURE_NOT_ELIGIBLE_FOR_WAIVER");
    assert.equal(await tokensFor(r.id), 0);

    // Recovery deadline passed / already waived.
    const d = await w.trialFamily("eld");
    await w.closed(d.uid, d.familyId);
    w.clock.advance(RECOVERY_WINDOW_MS);
    before = await issuerState(d.uid, d.familyId);
    await expectDomainError(w.prepare(w.fresh(d.uid), w.prepareReq(d.familyId, "WAIVE_RECOVERY")), "CLOSURE_RECOVERY_EXPIRED");
    assert.equal(await issuerState(d.uid, d.familyId), before);
    const v = await w.paidFamily("elv");
    await w.closed(v.uid, v.familyId);
    await w.waive(verified(v.uid), closeWith(v.familyId, await w.prepared(v.uid, v.familyId, "WAIVE_RECOVERY")));
    await expectDomainError(w.prepare(w.fresh(v.uid), w.prepareReq(v.familyId, "WAIVE_RECOVERY")), "RECOVERY_ALREADY_WAIVED");
  });

  test("local-only barrier: a non-emulator or non-demo runtime issues and stores nothing", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily("bar");
    const before = await issuerState(uid, familyId);
    for (const env of [{}, { FUNCTIONS_EMULATOR: "true", GCLOUD_PROJECT: "newbaileyscart" }, { GCLOUD_PROJECT: "demo-newbaileyscart" }]) {
      w.prepareHooks = { env };
      await expectDomainError(w.prepare(w.fresh(uid), w.prepareReq(familyId, "CLOSE")), "INTERNAL");
    }
    assert.equal(await issuerState(uid, familyId), before);
  });
});

describe("TTL boundary (server clock only)", () => {
  test("accepted at expiresAt - 1 ms; CONFIRMATION_EXPIRED at expiresAt with no mutation", async () => {
    const w = new World();
    const a = await w.trialFamily("ttla");
    const b = await w.trialFamily("ttlb");
    const ta = await w.prepared(a.uid, a.familyId, "CLOSE");
    const tb = await w.prepared(b.uid, b.familyId, "CLOSE");
    w.clock.advance(CONFIRMATION_TOKEN_TTL_MS - 1);
    assert.equal((await w.close(verified(a.uid), closeWith(a.familyId, ta))).data.lifecycleState, "CLOSING");
    w.clock.advance(1);
    const before = await snapshotState(b.uid, b.familyId);
    await expectDomainError(w.close(verified(b.uid), closeWith(b.familyId, tb)), "CONFIRMATION_EXPIRED");
    assert.equal(await snapshotState(b.uid, b.familyId), before);
    assert.equal((await pointer(b.familyId))?.["activeTokenHash"], sha(tb), "an expired token is not consumed");
  });
});

describe("family-wide supersession", () => {
  test("A then B (same action): A rejected without mutation, only B consumes", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily("sup");
    const a = await w.prepared(uid, familyId, "CLOSE");
    const b = await w.prepared(uid, familyId, "CLOSE");
    const before = await snapshotState(uid, familyId);
    await expectDomainError(w.close(verified(uid), closeWith(familyId, a)), "CONFIRMATION_REQUIRED");
    assert.equal(await snapshotState(uid, familyId), before);
    assert.equal((await db.doc(`confirmationTokens/${sha(a)}`).get()).get("consumedAt"), null, "superseded, not consumed");
    assert.equal((await w.close(verified(uid), closeWith(familyId, b))).data.lifecycleState, "CLOSING");
  });

  test("across actions: a WAIVE_RECOVERY preparation supersedes an outstanding close-action token, and back", async () => {
    // No lifecycle state accepts both actions, so the other-action token is seeded with the internal
    // issuer (which writes the same pointer) and supersession is observed on the shared pointer.
    const w = new World();
    const t = await w.trialFamily("xa");
    await w.closed(t.uid, t.familyId);
    const closeTok = await w.token(t.uid, t.familyId, "families.close");
    assert.equal((await pointer(t.familyId))?.["activeTokenHash"], sha(closeTok));
    const waiveTok = await w.prepared(t.uid, t.familyId, "WAIVE_RECOVERY");
    assert.equal((await pointer(t.familyId))?.["activeTokenHash"], sha(waiveTok), "one pointer per family, across actions");

    const a = await w.trialFamily("xb");
    const staleWaive = await w.token(a.uid, a.familyId, "families.waiveRecovery");
    const closeTok2 = await w.prepared(a.uid, a.familyId, "CLOSE");
    assert.equal((await pointer(a.familyId))?.["activeTokenHash"], sha(closeTok2));
    await w.close(verified(a.uid), closeWith(a.familyId, closeTok2));
    // The earlier waive-action token is now CLOSING-eligible by state, but superseded.
    const before = await snapshotState(a.uid, a.familyId);
    await expectDomainError(w.waive(verified(a.uid), closeWith(a.familyId, staleWaive)), "CONFIRMATION_REQUIRED");
    assert.equal(await snapshotState(a.uid, a.familyId), before);
  });

  test("epoch binding: a token prepared before restore is rejected after the epoch advances", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily("ep");
    await w.closed(uid, familyId);
    const old = await w.prepared(uid, familyId, "WAIVE_RECOVERY");
    await w.restore(verified(uid), w.restoreReq(familyId));
    const tok = await w.prepared(uid, familyId, "CLOSE");
    const res = await w.prepare(w.fresh(uid), w.prepareReq(familyId, "CLOSE"));
    assert.equal(res.data.familyEpoch, 2, "bound to the server epoch, never a client value");
    await w.close(verified(uid), closeWith(familyId, res.data.confirmationToken, 2));
    await expectDomainError(w.waive(verified(uid), closeWith(familyId, old, 2)), "CONFIRMATION_REQUIRED");
    await expectDomainError(w.close(verified(uid), closeWith(familyId, tok, 2)), "FAMILY_CLOSING");
  });
});

describe("same-opId retry (fail closed) and IDEMPOTENCY_KEY_REUSED", () => {
  test("identical retry: CONFIRMATION_REQUIRED, empty details, no plaintext, its own token invalidated", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily("rt");
    const req = w.prepareReq(familyId, "CLOSE");
    const first = await w.prepare(w.fresh(uid), req);
    const err = await expectDomainError(w.prepare(w.fresh(uid), { ...req }), "CONFIRMATION_REQUIRED");
    assert.deepEqual(err.details, {});
    assert.equal((await pointer(familyId))?.["activeTokenHash"], null);
    assert.equal(await tokensFor(familyId), 1, "no new token");
    const before = await snapshotState(uid, familyId);
    await expectDomainError(w.close(verified(uid), closeWith(familyId, first.data.confirmationToken)), "CONFIRMATION_REQUIRED");
    assert.equal(await snapshotState(uid, familyId), before);
    // A new opId obtains a usable replacement.
    const fresh = await w.prepared(uid, familyId, "CLOSE");
    assert.equal((await w.close(verified(uid), closeWith(familyId, fresh))).data.lifecycleState, "CLOSING");
  });

  test("changed payload under the same opId: IDEMPOTENCY_KEY_REUSED, nothing changes", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily("ik");
    const other = await w.trialFamily("ik2");
    const req = w.prepareReq(familyId, "CLOSE");
    const first = await w.prepare(w.fresh(uid), req);
    const before = await issuerState(uid, familyId);
    await expectDomainError(w.prepare(w.fresh(uid), { ...req, action: "WAIVE_RECOVERY" }), "IDEMPOTENCY_KEY_REUSED");
    await expectDomainError(w.prepare(w.fresh(uid), { ...req, familyId: other.familyId }), "IDEMPOTENCY_KEY_REUSED");
    // The same opId on a different command is reuse too, in both directions.
    await expectDomainError(w.close(verified(uid), closeWith(familyId, first.data.confirmationToken, 1, req.opId)), "IDEMPOTENCY_KEY_REUSED");
    assert.equal(await issuerState(uid, familyId), before);
    assert.equal((await w.close(verified(uid), closeWith(familyId, first.data.confirmationToken))).data.lifecycleState, "CLOSING");
  });

  test("a late retry never invalidates a newer token issued under a different opId", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily("late");
    const op1 = w.prepareReq(familyId, "CLOSE");
    await w.prepare(w.fresh(uid), op1);
    const newer = await w.prepared(uid, familyId, "CLOSE");
    const p0 = await pointer(familyId);
    await expectDomainError(w.prepare(w.fresh(uid), { ...op1 }), "CONFIRMATION_REQUIRED");
    assert.deepEqual(await pointer(familyId), p0, "pointer untouched");
    assert.equal((await w.close(verified(uid), closeWith(familyId, newer))).data.lifecycleState, "CLOSING");
  });

  test("another owner reusing the opId touches only their own records", async () => {
    const w = new World();
    const a = await w.trialFamily("oa");
    const b = await w.trialFamily("ob");
    const req = w.prepareReq(a.familyId, "CLOSE");
    const ta = (await w.prepare(w.fresh(a.uid), req)).data.confirmationToken;
    const pa = await pointer(a.familyId);
    await expectDomainError(w.prepare(w.fresh(b.uid), { ...req }), "OWNER_REQUIRED");
    const tb = await w.prepare(w.fresh(b.uid), { ...req, familyId: b.familyId });
    assert.equal(tb.data.familyId, b.familyId, "B's opId namespace is independent of A's");
    assert.deepEqual(await pointer(a.familyId), pa);
    assert.equal((await w.close(verified(a.uid), closeWith(a.familyId, ta))).data.lifecycleState, "CLOSING");
  });
});

describe("throttle (sprint policy: 5 per family per rolling 15 minutes, across actions)", () => {
  test("fifth issuance succeeds, sixth is RATE_LIMITED with no write; counts across actions; window rolls", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily("thr");
    for (let i = 0; i < 2; i++) await w.prepared(uid, familyId, "CLOSE");
    w.clock.advance(60_000);
    await w.close(verified(uid), closeWith(familyId, await w.prepared(uid, familyId, "CLOSE"))); // 3rd
    await w.prepared(uid, familyId, "WAIVE_RECOVERY"); // 4th
    const fifthReq = w.prepareReq(familyId, "WAIVE_RECOVERY");
    const fifth = (await w.prepare(w.fresh(uid), fifthReq)).data.confirmationToken; // 5th
    const before = await issuerState(uid, familyId);
    await expectDomainError(w.prepare(w.fresh(uid), w.prepareReq(familyId, "WAIVE_RECOVERY")), "RATE_LIMITED");
    assert.equal(await issuerState(uid, familyId), before, "a throttled call writes nothing");
    assert.equal((await pointer(familyId))?.["activeTokenHash"], sha(fifth), "the fifth token stays valid");
    // A same-opId retry is a rejection, not an issuance: CONFIRMATION_REQUIRED even at the limit,
    // and it adds nothing to the window.
    await expectDomainError(w.prepare(w.fresh(uid), { ...fifthReq }), "CONFIRMATION_REQUIRED");
    assert.equal(((await pointer(familyId))?.["issuedAt"] as unknown[]).length, 5);
    // The two earliest issuances (at T0) leave the window at T0 + 15 min.
    w.clock.millis = T0 + ISSUANCE_WINDOW_MS - 1;
    await expectDomainError(w.prepare(w.fresh(uid), w.prepareReq(familyId, "WAIVE_RECOVERY")), "RATE_LIMITED");
    w.clock.millis = T0 + ISSUANCE_WINDOW_MS;
    await w.prepared(uid, familyId, "WAIVE_RECOVERY");
    assert.ok(((await pointer(familyId))?.["issuedAt"] as unknown[]).length <= 5, "bounded window record");
  });

  test("malformed rate record or failed transaction: fail closed, no token", async () => {
    const w = new World();
    const { uid, familyId } = await w.trialFamily("rf");
    await w.prepared(uid, familyId, "CLOSE");
    await db.doc(`lifecycleConfirmations/${familyId}`).update({ issuedAt: "corrupt" });
    const before = await issuerState(uid, familyId);
    await expectDomainError(w.prepare(w.fresh(uid), w.prepareReq(familyId, "CLOSE")), "INTERNAL");
    assert.equal(await issuerState(uid, familyId), before);

    const g = await w.trialFamily("rg");
    const gBefore = await issuerState(g.uid, g.familyId);
    w.prepareHooks = { afterReads: async () => Promise.reject(new Error("injected commit failure")) };
    const logged: string[] = [];
    let issued = "";
    w.prepareHooks = {
      ...w.prepareHooks,
      randomToken: () => (issued = "Q".repeat(43)),
    };
    await assert.rejects(
      runCallable("families.prepareLifecycleConfirmation", { auth: { uid: g.uid, token: { email_verified: true, auth_time: Math.floor(T0 / 1000) } }, data: w.prepareReq(g.familyId, "CLOSE") }, w.prepare, (m, r) => logged.push(m + JSON.stringify(r))),
      (e: unknown) => (e as { code?: string }).code === "internal",
    );
    assert.equal(await issuerState(g.uid, g.familyId), gBefore, "rolled back: no token, pointer or idempotency record");
    assert.equal(logged.length, 1);
    assert.ok(issued !== "" && !logged[0]?.includes(issued), "the plaintext never reaches the failure log");
  });
});

describe("concurrency (PL-PP-WP03-32 races)", () => {
  test(`N parallel preparations: all commit, exactly one valid token, one consumption (x${STRESS})`, async () => {
    for (let i = 0; i < STRESS; i++) {
      const w = new World();
      const { uid, familyId } = await w.trialFamily(`pp${i}`);
      const res = await Promise.all(Array.from({ length: PARALLEL }, () => w.prepare(w.fresh(uid), w.prepareReq(familyId, "CLOSE"))));
      const active = (await pointer(familyId))?.["activeTokenHash"];
      const winners = res.filter((r) => sha(r.data.confirmationToken) === active);
      assert.equal(winners.length, 1, `iteration ${i}: one active token`);
      const outcomes = await Promise.allSettled(res.map((r) => w.close(verified(uid), closeWith(familyId, r.data.confirmationToken))));
      assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1, `iteration ${i}: one close`);
      for (const o of outcomes) if (o.status === "rejected") assert.ok(o.reason instanceof DomainError && ["CONFIRMATION_REQUIRED", "FAMILY_CLOSING"].includes(o.reason.code));
      assert.equal((await db.collection("closureCases").where("familyId", "==", familyId).get()).size, 1);
    }
  });

  test(`preparation racing consumption serializes (x${STRESS})`, async () => {
    for (let i = 0; i < STRESS; i++) {
      const w = new World();
      const { uid, familyId } = await w.trialFamily(`pc${i}`);
      const t1 = await w.prepared(uid, familyId, "CLOSE");
      const [c, p] = await Promise.allSettled([w.close(verified(uid), closeWith(familyId, t1)), w.prepare(w.fresh(uid), w.prepareReq(familyId, "CLOSE"))]);
      const fam = await familyDoc(familyId);
      const ptr = await pointer(familyId);
      if (c.status === "fulfilled") {
        assert.equal(fam["lifecycleState"], "CLOSING", `iteration ${i}`);
        // The close committed, so the racing preparation must have serialized after it.
        assert.equal(p.status, "rejected", `iteration ${i}: both committed`);
        assert.ok(p.reason instanceof DomainError && p.reason.code === "FAMILY_CLOSING");
        assert.equal(ptr?.["activeTokenHash"], null);
      } else {
        assert.ok(c.reason instanceof DomainError && c.reason.code === "CONFIRMATION_REQUIRED", `iteration ${i}: ${String(c.reason)}`);
        assert.equal(fam["lifecycleState"], "ACTIVE");
        assert.equal(fam["lifecycleRevision"] ?? 0, 0, "no lifecycle mutation");
        assert.equal(p.status, "fulfilled");
        if (p.status === "fulfilled") assert.equal(ptr?.["activeTokenHash"], sha(p.value.data.confirmationToken));
      }
    }
  });

  test(`two consumptions of one token (close vs close, distinct opIds) commit at most once (x${STRESS})`, async () => {
    for (let i = 0; i < STRESS; i++) {
      const w = new World();
      const { uid, familyId } = await w.trialFamily(`dc${i}`);
      const t = await w.prepared(uid, familyId, "CLOSE");
      const r = await Promise.allSettled([w.close(verified(uid), closeWith(familyId, t)), w.close(verified(uid), closeWith(familyId, t))]);
      assert.equal(r.filter((x) => x.status === "fulfilled").length, 1, `iteration ${i}`);
      assert.equal((await db.collection("closureCases").where("familyId", "==", familyId).get()).size, 1);
    }
  });

  test(`two waivers racing on one token in CLOSING: one release, one claim clear (x${STRESS})`, async () => {
    for (let i = 0; i < STRESS; i++) {
      const w = new World();
      const { uid, familyId } = await w.trialFamily(`dw${i}`);
      await w.closed(uid, familyId);
      const t = await w.prepared(uid, familyId, "WAIVE_RECOVERY");
      const r = await Promise.allSettled([w.waive(verified(uid), closeWith(familyId, t)), w.waive(verified(uid), closeWith(familyId, t))]);
      assert.equal(r.filter((x) => x.status === "fulfilled").length, 1, `iteration ${i}`);
      assert.equal((await db.collection("ownershipReleaseAudits").where("familyId", "==", familyId).get()).size, 1);
    }
  });

  test(`identical same-opId preparations in parallel: at most one plaintext, one token record (x${STRESS})`, async () => {
    for (let i = 0; i < STRESS; i++) {
      const w = new World();
      const { uid, familyId } = await w.trialFamily(`so${i}`);
      const req = w.prepareReq(familyId, "CLOSE");
      const r = await Promise.allSettled(Array.from({ length: PARALLEL }, () => w.prepare(w.fresh(uid), { ...req })));
      const ok = r.filter((x) => x.status === "fulfilled");
      assert.equal(ok.length, 1, `iteration ${i}: one issuance`);
      for (const x of r) if (x.status === "rejected") assert.ok(x.reason instanceof DomainError && x.reason.code === "CONFIRMATION_REQUIRED");
      assert.equal(await tokensFor(familyId), 1);
      // Every retry committed after the issuance, so the issued token was invalidated (fail closed).
      assert.equal((await pointer(familyId))?.["activeTokenHash"], null);
    }
  });
});
