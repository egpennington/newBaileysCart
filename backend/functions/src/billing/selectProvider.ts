/**
 * Runtime provider selection (PL-3B-02). The deterministic fake is used only inside the Functions
 * emulator AND a `demo-` project; every other runtime gets the fail-closed provider. There is no
 * live Google Play adapter to select in Stage B1, and no environment variable can enable one.
 */
import { FakeBillingProvider } from "./fakeProvider.js";
import { unavailableBillingProvider } from "./provider.js";
import type { BillingProvider } from "./provider.js";

export type RuntimeEnv = Readonly<Record<string, string | undefined>>;

export function isEmulatorDemoRuntime(env: RuntimeEnv): boolean {
  const project = env["GCLOUD_PROJECT"] ?? env["GCP_PROJECT"] ?? "";
  return env["FUNCTIONS_EMULATOR"] === "true" && project.startsWith("demo-");
}

export function selectBillingProvider(env: RuntimeEnv): BillingProvider {
  return isEmulatorDemoRuntime(env) ? new FakeBillingProvider() : unavailableBillingProvider;
}
