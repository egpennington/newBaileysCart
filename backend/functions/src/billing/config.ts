/**
 * Stage B1 billing configuration. Synthetic only: no Play Console product, base plan or package
 * has been provisioned (readiness plan; WP00-OPEN-01). These values exist so fake-provider tests can
 * prove package/product binding. They are not ratified product identifiers.
 */
export interface BillingConfig {
  /** Android applicationId the purchase must belong to. */
  readonly packageName: string;
  /** Subscription product IDs a family purchase may use. */
  readonly productIds: readonly string[];
}

export const B1_SYNTHETIC_BILLING_CONFIG: BillingConfig = {
  packageName: "com.penningtonlabs.baileyscart.wp00placeholder",
  productIds: ["synthetic.family.subscription"],
};
