import { strict as assert } from "node:assert";
import { test } from "node:test";
import { WORK_PACKAGE, buildContractVersion } from "../src/index.js";

test("backend skeleton exposes the WP-00 build contract", () => {
  assert.equal(WORK_PACKAGE, "WP-00");
  assert.equal(buildContractVersion(), "WP-00-backend-skeleton");
});
