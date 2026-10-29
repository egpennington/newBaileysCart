/** Firestore document paths (Slice 1 plan §4.1). All are server-written; rules deny clients. */
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
} as const;
