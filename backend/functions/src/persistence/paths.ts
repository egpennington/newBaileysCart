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
  familyBilling: (familyId: string) => `familyBilling/${familyId}`,
  ownershipReleaseAudit: (caseId: string) => `ownershipReleaseAudits/${caseId}`,
  reservationCase: (familyId: string) => `reservationCases/${familyId}`,
} as const;
