/**
 * WP-03 callables. Callable names cannot contain "." so API v0.4 command `families.create` is
 * exported as `familiesCreate`, `account.getSession` as `accountGetSession`, and the Slice 3
 * lifecycle commands as `familiesClose`, `familiesGetClosureStatus`, `familiesRestore` and
 * `familiesWaiveRecovery` (A1 naming rule). App Check enforcement stays off (W-01 D-4).
 *
 * Billing (Substage 3A): the deterministic fake provider is wired ONLY when running under the
 * Functions emulator. Every other runtime gets the fail-closed provider, so no real liability is
 * ever established and no cancellation is ever reported verified. Not deployed (no Gate for it).
 * Slice 3B Stage B1 adds no callable: the billing engine, RTDN processor and purchase binding are
 * internal functions driven by emulator tests (billing/selectProvider.ts keeps the fake demo-only).
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import type { BillingProvider } from "./billing/provider.js";
import { selectBillingProvider } from "./billing/selectProvider.js";
import { runCallable } from "./callable/adapter.js";
import { accountGetSessionHandler } from "./commands/accountGetSession.js";
import { familiesCloseHandler } from "./commands/familiesClose.js";
import { familiesCreateHandler } from "./commands/familiesCreate.js";
import { familiesGetClosureStatusHandler } from "./commands/familiesGetClosureStatus.js";
import { familiesRestoreHandler } from "./commands/familiesRestore.js";
import { familiesWaiveRecoveryHandler } from "./commands/familiesWaiveRecovery.js";
import { systemClock } from "./domain/clock.js";

initializeApp();
const db = getFirestore();
const provider: BillingProvider = selectBillingProvider(process.env);
const deps = { db, clock: systemClock, provider };

const createFamily = familiesCreateHandler({ db, clock: systemClock });
const getSession = accountGetSessionHandler({ db, clock: systemClock });
const closeFamily = familiesCloseHandler(deps);
const getClosureStatus = familiesGetClosureStatusHandler(deps);
const restoreFamily = familiesRestoreHandler(deps);
const waiveRecovery = familiesWaiveRecoveryHandler(deps);

export const familiesCreate = onCall({ enforceAppCheck: false }, (request) =>
  runCallable("families.create", request, createFamily),
);

export const accountGetSession = onCall({ enforceAppCheck: false }, (request) =>
  runCallable("account.getSession", request, getSession),
);

export const familiesClose = onCall({ enforceAppCheck: false }, (request) =>
  runCallable("families.close", request, closeFamily),
);

export const familiesGetClosureStatus = onCall({ enforceAppCheck: false }, (request) =>
  runCallable("families.getClosureStatus", request, getClosureStatus),
);

export const familiesRestore = onCall({ enforceAppCheck: false }, (request) =>
  runCallable("families.restore", request, restoreFamily),
);

export const familiesWaiveRecovery = onCall({ enforceAppCheck: false }, (request) =>
  runCallable("families.waiveRecovery", request, waiveRecovery),
);
