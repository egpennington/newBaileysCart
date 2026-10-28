/**
 * WP-03 Slice 1 callables. Callable names cannot contain "." so API v0.4 command
 * `families.create` is exported as `familiesCreate`, and `account.getSession` as
 * `accountGetSession`. App Check enforcement stays off for Slice 1 (W-01 D-4).
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { runCallable } from "./callable/adapter.js";
import { accountGetSessionHandler } from "./commands/accountGetSession.js";
import { familiesCreateHandler } from "./commands/familiesCreate.js";
import { systemClock } from "./domain/clock.js";

initializeApp();
const db = getFirestore();

const createFamily = familiesCreateHandler({ db, clock: systemClock });
const getSession = accountGetSessionHandler({ db, clock: systemClock });

export const familiesCreate = onCall({ enforceAppCheck: false }, (request) =>
  runCallable("families.create", request, createFamily),
);

export const accountGetSession = onCall({ enforceAppCheck: false }, (request) =>
  runCallable("account.getSession", request, getSession),
);
