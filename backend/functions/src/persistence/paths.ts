/** Firestore document paths (Slice 1 plan §4.1; Slice 3 additions). All are server-written; rules deny clients. */
export const SCHEMA_VERSION = 1;

export const paths = {
  family: (familyId: string) => `families/${familyId}`,
  familyMember: (familyId: string, uid: string) => `families/${familyId}/members/${uid}`,
  user: (uid: string) => `users/${uid}`,
  userMemberships: (uid: string) => `users/${uid}/memberships`,
  userMembership: (uid: string, familyId: string) => `users/${uid}/memberships/${familyId}`,
  trialLedger: (uid: string) => `trialLedger/${uid}`,
  idempotency: (key: string) => `idempotency/${key}`,
  familiesCollection: "families",
  familyMembers: (familyId: string) => `families/${familyId}/members`,
  // WP-03 Slice 3 (server-only; firestore.rules denies every client read and write).
  closureCasesCollection: "closureCases",
  closureCase: (caseId: string) => `closureCases/${caseId}`,
  confirmationToken: (tokenHash: string) => `confirmationTokens/${tokenHash}`,
  // A2-D4: one family-scoped pointer naming the only active token, plus the issuance window.
  confirmationPointer: (familyId: string) => `lifecycleConfirmations/${familyId}`,
  familyBilling: (familyId: string) => `familyBilling/${familyId}`,
  ownershipReleaseAudit: (caseId: string) => `ownershipReleaseAudits/${caseId}`,
  reservationCase: (familyId: string) => `reservationCases/${familyId}`,
  // WP-03 Slice 3B Stage B1 (server-only). The binding id is SHA-256(purchaseToken); the delivery
  // id is SHA-256(Pub/Sub messageId). Neither path ever contains a raw token.
  purchaseBinding: (purchaseRef: string) => `purchaseBindings/${purchaseRef}`,
  rtdnDelivery: (deliveryRef: string) => `rtdnDeliveries/${deliveryRef}`,
  // BC-FAMILY-SYNC-01 (Sync Contract Rev 2). `items` and `invites` are server-only. `listItems` and
  // `listMeta/current` are the only documents firestore.rules lets clients read (ACTIVE members).
  familyItem: (familyId: string, itemId: string) => `families/${familyId}/items/${itemId}`,
  familyListItem: (familyId: string, itemId: string) => `families/${familyId}/listItems/${itemId}`,
  familyListItems: (familyId: string) => `families/${familyId}/listItems`,
  familyListMeta: (familyId: string) => `families/${familyId}/listMeta/current`,
  invite: (codeHash: string) => `invites/${codeHash}`,
} as const;
