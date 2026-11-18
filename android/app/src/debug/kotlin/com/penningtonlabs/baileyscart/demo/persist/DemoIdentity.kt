package com.penningtonlabs.baileyscart.demo.persist

import com.penningtonlabs.baileyscart.core.storage.FakeVerifiedSession

/**
 * LP-0 exception E-11a (debug source set ONLY). The LOCAL DEMO derives its storage account tag
 * and Keystore aliases from this one fixed, fictional, compile-time identity. It is never
 * user-entered, never a real UID, grants nothing, and involves no authentication.
 *
 * D-11 still governs every real-account path. This file must never move to src/main or
 * src/release: scripts/check-release-isolation.sh fails if [DEMO_UID], [ALIAS_PREFIX] or
 * [STORE_DIR] appear anywhere in the release APK.
 */
internal object DemoIdentity {
    /** Fictional. `FakeVerifiedSession` accepts only `demo-` identities. */
    const val DEMO_UID: String = "demo-local-list-e11a"

    /** Keystore alias prefix for the demo's tag key and KEK (letters, digits and `_` only). */
    const val ALIAS_PREFIX: String = "bcdemo_"

    /** Directory under Context.noBackupFilesDir that holds the demo's encrypted files. */
    const val STORE_DIR: String = "bc-local-demo-store"

    fun session(): FakeVerifiedSession = FakeVerifiedSession(DEMO_UID)
}
