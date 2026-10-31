/**
 * D1: account.getSession hardening (WP03_S1_HARDENING_BACKLOG_v1.1.md; PL output decision
 * 2026-10-31: INTERNAL for HB-1 and HB-3). Drives the pure mapper with malformed and
 * inconsistent storage, then the handler over an in-memory Firestore fake for logging, the
 * fail-closed rejection and the read-only transaction (T-GAP-6). Every successful build is
 * checked against API Amendment A1 v0.2 §A1.5.
 */
import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { accountGetSessionHandler, integrityLogRecord } from "../../src/commands/accountGetSession.js";
import { DomainError } from "../../src/contract/errors.js";
import { RESERVATION_TTL_MS, TRIAL_DURATION_MS } from "../../src/domain/family.js";
import { buildSession } from "../../src/domain/session.js";
import type { IntegrityEvent, IntegrityReason, SessionData, StoredEntry, StoredSession } from "../../src/domain/session.js";
import { assertSessionDataConformsToA1 } from "../support/a1Schema.js";
import { FakeFirestore } from "../support/fakeFirestore.js";

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0, 0);
const UID = "caller-uid-7f3a";
const OWNED = "fOwned0001";
const trial = { lifecycleState: "ACTIVE", trialEndsAt: Timestamp.fromMillis(NOW + TRIAL_DURATION_MS) };
const reservation = { lifecycleState: "UNENTITLED_AWAITING_PAYMENT", reservationExpiresAt: Timestamp.fromMillis(NOW + RESERVATION_TTL_MS) };

const owner = (familyId: string, family: Record<string, unknown> = trial): StoredEntry => ({
  familyId,
  family: { ownerUid: UID, ...family },
  memberRole: "OWNER",
});
const member = (familyId: string, family: Record<string, unknown> = trial): StoredEntry => ({
  familyId,
  family: { ownerUid: "someone-else", ...family },
  memberRole: "MEMBER",
});
const session = (entries: StoredEntry[], ownedFamilyId: unknown = OWNED): StoredSession => ({
  uid: UID,
  ownedFamilyId,
  trialLedgerExists: true,
  entries,
});
const without = (record: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

/** The build must succeed and conform to A1 §A1.5. */
function ok(stored: StoredSession): { data: SessionData; events: readonly IntegrityEvent[] } {
  const built = buildSession(stored, NOW);
  assert.ok(built.ok, `expected a session, got ${JSON.stringify(built.events)}`);
  assertSessionDataConformsToA1(built.data);
  return built;
}

/** The build must fail closed: no data at all, and exactly these fatal events. */
function failsClosed(stored: StoredSession, expected: Array<[IntegrityReason, string | null]>): void {
  const built = buildSession(stored, NOW);
  assert.equal(built.ok, false, "expected fail-closed");
  assert.equal("data" in built, false, "a failed build must carry no session data");
  assert.deepEqual(
    built.events.filter((e) => e.fatal).map((e) => [e.reason, e.familyId]),
    expected,
  );
}

describe("buildSession: consistent Slice 1 data is unchanged", () => {
  test("owner of a named trial family and member of another", () => {
    const { data, events } = ok(session([member("Zmember01"), owner(OWNED, { ...trial, displayName: "Home" })]));
    assert.deepEqual(events, []);
    assert.deepEqual(data, {
      ownedFamilyId: OWNED,
      joinedFamilies: [
        { familyId: "Zmember01", role: "MEMBER", accessMode: "READ_WRITE" },
        {
          familyId: OWNED,
          role: "OWNER",
          accessMode: "READ_WRITE",
          displayName: "Home",
          lifecycleState: "ACTIVE",
          trialEndsAt: "2026-11-21T12:00:00.000Z",
        },
      ],
      trialEligible: false,
      selectedFamilySuggestion: OWNED,
    });
  });
  test("unpaid reservation owner: NONE, no suggestion", () => {
    const { data, events } = ok(session([owner(OWNED, reservation)]));
    assert.deepEqual(events, []);
    assert.equal(data.joinedFamilies[0]?.accessMode, "NONE");
    assert.equal(data.selectedFamilySuggestion, null);
  });
  test("new user: no claim, no entries", () => {
    for (const claim of [undefined, null]) {
      const { data } = ok({ uid: UID, ownedFamilyId: claim, trialLedgerExists: false, entries: [] });
      assert.deepEqual(data, { ownedFamilyId: null, joinedFamilies: [], trialEligible: true, selectedFamilySuggestion: null });
    }
  });
  test("ACTIVE owner with no trial end: NONE as A1 §A1.5 defines, not an integrity failure", () => {
    const { data, events } = ok(session([owner(OWNED, { lifecycleState: "ACTIVE" })]));
    assert.deepEqual(events, []);
    assert.equal(data.joinedFamilies[0]?.accessMode, "NONE");
  });
  test("A1 role rule kept: an OWNER edge on another owner's family is a MEMBER entry", () => {
    const { data, events } = ok(session([{ ...member("fOther0001"), memberRole: "OWNER" }], null));
    assert.deepEqual(events, []);
    assert.deepEqual(data.joinedFamilies, [{ familyId: "fOther0001", role: "MEMBER", accessMode: "READ_WRITE" }]);
  });
});

describe("HB-1 (F-1): OWNER entry with a malformed stored lifecycleState fails closed", () => {
  const triggers: Record<string, Record<string, unknown>> = {
    missing: without(trial, "lifecycleState"),
    null: { ...trial, lifecycleState: null },
    "empty string": { ...trial, lifecycleState: "" },
    number: { ...trial, lifecycleState: 42 },
    "wrong case": { ...trial, lifecycleState: "active" },
    "unrecognized value": { ...trial, lifecycleState: "CLOSING" },
  };
  for (const [name, family] of Object.entries(triggers)) {
    test(`${name} -> INTERNAL, OWNER_LIFECYCLE_STATE_INVALID`, () => {
      failsClosed(session([owner(OWNED, family)]), [["OWNER_LIFECYCLE_STATE_INVALID", OWNED]]);
    });
    test(`${name} on a MEMBER entry -> accessMode NONE, no lifecycleState, call succeeds`, () => {
      const { data, events } = ok(session([member("fJoined01", family)], null));
      assert.deepEqual(events, []);
      assert.deepEqual(data.joinedFamilies, [{ familyId: "fJoined01", role: "MEMBER", accessMode: "NONE" }]);
    });
  }
});

describe("HB-2 (F-2): malformed stored displayName is omitted and logged", () => {
  const triggers: Record<string, unknown> = {
    null: null,
    number: 42,
    object: { text: "Home" },
    empty: "",
    "whitespace only": "   ",
    "51 code points": "x".repeat(51),
    "control character (Cc)": "Ho\u0000me",
    "format character (Cf, ZWSP)": "Ho​me",
    "line separator (Zl)": "Ho me",
    "paragraph separator (Zp)": "Ho me",
    "lone surrogate (Cs)": "Ho\uD800me",
    "Hangul filler": "ㅤ",
  };
  for (const [name, displayName] of Object.entries(triggers)) {
    for (const [role, entry] of [
      ["OWNER", owner(OWNED, { ...trial, displayName })],
      ["MEMBER", member("fJoined01", { ...trial, displayName })],
    ] as const) {
      test(`${role}, ${name} -> key omitted, non-fatal DISPLAY_NAME_INVALID`, () => {
        const { data, events } = ok(session([entry], role === "OWNER" ? OWNED : null));
        assert.equal("displayName" in (data.joinedFamilies[0] ?? {}), false);
        assert.deepEqual(events, [{ reason: "DISPLAY_NAME_INVALID", familyId: entry.familyId, fatal: false }]);
      });
    }
  }
  test("valid names are emitted: 50 code points (astral), and the stored value trimmed as PL-5 does", () => {
    const fifty = "\u{1F6D2}".repeat(50);
    const { data, events } = ok(
      session([member("fA", { ...trial, displayName: fifty }), owner(OWNED, { ...trial, displayName: "  Home  " })]),
    );
    assert.deepEqual(events, []);
    assert.deepEqual(
      data.joinedFamilies.map((f) => f.displayName),
      [fifty, "Home"],
    );
  });
  test("an absent displayName is not an integrity event", () => {
    assert.deepEqual(ok(session([owner(OWNED)])).events, []);
  });
});

describe("HB-3 (F-3): inconsistent stored records fail closed", () => {
  test("(1) two OWNER memberships for one UID", () => {
    failsClosed(session([owner("fOwnerA"), owner("fOwnerB")], "fOwnerA"), [
      ["MULTIPLE_OWNER_ENTRIES", "fOwnerA"],
      ["MULTIPLE_OWNER_ENTRIES", "fOwnerB"],
      ["OWNER_ENTRY_WITHOUT_CLAIM", "fOwnerB"],
    ]);
  });
  test("(2) ownedFamilyId claim with no OWNER membership", () => {
    failsClosed(session([]), [["CLAIM_WITHOUT_OWNER_ENTRY", OWNED]]);
  });
  test("(2) ownedFamilyId names a family the caller is only a MEMBER of", () => {
    const entry: StoredEntry = { familyId: OWNED, family: { ownerUid: UID, ...trial }, memberRole: "MEMBER" };
    failsClosed(session([entry]), [["CLAIM_WITHOUT_OWNER_ENTRY", OWNED]]);
  });
  test("(2) OWNER membership with no claim", () => {
    for (const claim of [undefined, null]) {
      failsClosed({ ...session([owner(OWNED)]), ownedFamilyId: claim }, [["OWNER_ENTRY_WITHOUT_CLAIM", OWNED]]);
    }
  });
  test("(2) claim and OWNER membership name different families", () => {
    failsClosed(session([owner("fOwnerB")], OWNED), [
      ["OWNER_ENTRY_WITHOUT_CLAIM", "fOwnerB"],
      ["CLAIM_WITHOUT_OWNER_ENTRY", OWNED],
    ]);
  });
  test("(2) malformed claim: logged without echoing the stored value", () => {
    for (const claim of ["", 42, { id: OWNED }, true]) {
      failsClosed(session([], claim), [["CLAIM_WITHOUT_OWNER_ENTRY", null]]);
    }
  });
  const inconsistent: Record<string, Record<string, unknown>> = {
    "ACTIVE with both timestamps": { ...trial, reservationExpiresAt: reservation.reservationExpiresAt },
    "ACTIVE with a reservation timestamp only": { lifecycleState: "ACTIVE", reservationExpiresAt: reservation.reservationExpiresAt },
    "reservation with a trial timestamp": { ...reservation, trialEndsAt: trial.trialEndsAt },
    "reservation with no reservation timestamp": { lifecycleState: "UNENTITLED_AWAITING_PAYMENT" },
  };
  for (const [name, family] of Object.entries(inconsistent)) {
    test(`(3) OWNER ${name}`, () => {
      failsClosed(session([owner(OWNED, family)]), [["LIFECYCLE_TIMESTAMPS_INCONSISTENT", OWNED]]);
    });
  }
  test("(3)+(4) MEMBER family with both timestamps: no READ_WRITE from an inconsistent record", () => {
    failsClosed(session([member("fJoined01", { ...trial, reservationExpiresAt: reservation.reservationExpiresAt })], null), [
      ["LIFECYCLE_TIMESTAMPS_INCONSISTENT", "fJoined01"],
    ]);
  });
  test("(3) both timestamps on an unrecognized lifecycle state", () => {
    const family = { lifecycleState: "CLOSING", trialEndsAt: trial.trialEndsAt, reservationExpiresAt: reservation.reservationExpiresAt };
    failsClosed(session([member("fJoined01", family)], null), [["LIFECYCLE_TIMESTAMPS_INCONSISTENT", "fJoined01"]]);
  });
  for (const [name, value] of Object.entries({ string: "2026-11-21T12:00:00.000Z", number: NOW, object: { seconds: 1 } })) {
    test(`(3) malformed timestamp (${name}) on OWNER and MEMBER entries`, () => {
      // The malformed entry is not reported, so the owner claim is also left unmatched.
      failsClosed(session([owner(OWNED, { ...trial, trialEndsAt: value })]), [
        ["LIFECYCLE_TIMESTAMP_MALFORMED", OWNED],
        ["CLAIM_WITHOUT_OWNER_ENTRY", OWNED],
      ]);
      failsClosed(session([member("fJoined01", { ...trial, reservationExpiresAt: value })], null), [
        ["LIFECYCLE_TIMESTAMP_MALFORMED", "fJoined01"],
      ]);
    });
  }
  test("(4) an inconsistent record elsewhere fails the whole call, even with a usable family", () => {
    failsClosed(session([member("fUsable01"), owner("fOwnerB")], null), [["OWNER_ENTRY_WITHOUT_CLAIM", "fOwnerB"]]);
  });
});

describe("integrity events carry identifiers only", () => {
  test("no UID, display name or stored value reaches an event or its log record", () => {
    const built = buildSession(
      session([owner("fOwnerB", { ...trial, displayName: null, lifecycleState: "secret-state" })], "claim-secret"),
      NOW,
    );
    assert.ok(built.events.length > 0);
    for (const event of built.events) {
      assert.deepEqual(Object.keys(event).sort(), ["familyId", "fatal", "reason"]);
      const record = integrityLogRecord(event);
      assert.deepEqual(Object.keys(record).sort(), ["command", "familyId", "reason"]);
      assert.equal(record.command, "account.getSession");
      const serialized = JSON.stringify(record);
      for (const leak of [UID, "secret-state"]) assert.ok(!serialized.includes(leak), serialized);
    }
  });
});

describe("handler over a Firestore fake (D1)", () => {
  function seed(fake: FakeFirestore, familyId: string, family: Record<string, unknown>, role = "OWNER"): void {
    const edge = { role, state: "ACTIVE" };
    fake.docs.set(`families/${familyId}`, family);
    fake.docs.set(`families/${familyId}/members/${UID}`, edge);
    fake.docs.set(`users/${UID}/memberships/${familyId}`, edge);
  }

  test("HB-1/HB-3: a fatal integrity event is logged and the call rejects with INTERNAL", async () => {
    const fake = new FakeFirestore();
    seed(fake, OWNED, { ownerUid: UID, ...trial, lifecycleState: null });
    fake.docs.set(`users/${UID}`, { ownedFamilyId: OWNED });
    const logged: IntegrityEvent[] = [];
    const handler = accountGetSessionHandler({ db: fake.asFirestore, clock: { nowMillis: () => NOW }, integrityLog: (e) => logged.push(e) });
    await assert.rejects(handler({ uid: UID, emailVerified: true }, { apiVersion: "v0.4" }), (e: unknown) => {
      assert.ok(e instanceof DomainError);
      assert.equal(e.code, "INTERNAL");
      assert.deepEqual(e.details, {}, "the rejection carries no record details");
      return true;
    });
    assert.deepEqual(logged, [{ reason: "OWNER_LIFECYCLE_STATE_INVALID", familyId: OWNED, fatal: true }]);
  });

  test("HB-2: a non-fatal event is logged and the session is returned", async () => {
    const fake = new FakeFirestore();
    seed(fake, OWNED, { ownerUid: UID, ...trial, displayName: "" });
    fake.docs.set(`users/${UID}`, { ownedFamilyId: OWNED });
    const logged: IntegrityEvent[] = [];
    const handler = accountGetSessionHandler({ db: fake.asFirestore, clock: { nowMillis: () => NOW }, integrityLog: (e) => logged.push(e) });
    const res = await handler({ uid: UID, emailVerified: true }, { apiVersion: "v0.4" });
    assertSessionDataConformsToA1(res.data);
    assert.equal("displayName" in (res.data.joinedFamilies[0] ?? {}), false);
    assert.deepEqual(logged, [{ reason: "DISPLAY_NAME_INVALID", familyId: OWNED, fatal: false }]);
  });

  test("T-GAP-6: one read-only transaction; every read goes through it; no writes", async () => {
    const fake = new FakeFirestore();
    seed(fake, OWNED, { ownerUid: UID, ...trial });
    seed(fake, "fJoined01", { ownerUid: "someone-else", ...trial }, "MEMBER");
    fake.docs.set(`users/${UID}`, { ownedFamilyId: OWNED });
    const handler = accountGetSessionHandler({ db: fake.asFirestore, clock: { nowMillis: () => NOW } });
    const res = await handler({ uid: UID, emailVerified: true }, { apiVersion: "v0.4" });
    assert.equal(res.data.joinedFamilies.length, 2);
    assert.deepEqual(fake.transactionOptions, [{ readOnly: true }]);
    assert.deepEqual(fake.transactionWrites, []);
    // The fake has no reads outside runTransaction, so reaching here means none were attempted;
    // these are the reads made inside it.
    assert.deepEqual(fake.transactionReads.sort(), [
      `families/${OWNED}`,
      `families/${OWNED}/members/${UID}`,
      "families/fJoined01",
      `families/fJoined01/members/${UID}`,
      `trialLedger/${UID}`,
      `users/${UID}`,
      `users/${UID}/memberships/${OWNED}`,
      `users/${UID}/memberships/fJoined01`,
    ].sort());
  });
});
