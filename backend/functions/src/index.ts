/**
 * WP-00 placeholder proving the backend TypeScript build and test harness.
 * Callable functions, Firestore rules and the Firebase SDK are WP-03 scope.
 */
export const WORK_PACKAGE = "WP-00";

export function buildContractVersion(): string {
  return `${WORK_PACKAGE}-backend-skeleton`;
}
