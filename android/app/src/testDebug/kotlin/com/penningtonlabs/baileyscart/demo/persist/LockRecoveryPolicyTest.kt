package com.penningtonlabs.baileyscart.demo.persist

import com.penningtonlabs.baileyscart.core.storage.LockReason
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * BC-S2-LOCAL-PERSIST LP-3c D1: which locks offer the user-confirmed set-aside, and what the locked
 * screen suggests. Expected values are listed explicitly, not derived from the code under test.
 */
class LockRecoveryPolicyTest {
    private val retryOnly = setOf(StoreLock.KEY_TRANSIENT, StoreLock.OPEN_ERROR)

    @Test fun theEncryptedStoreOffersNoSetAsideForAMissingTagKeyOrATransientKeystoreFailure() {
        val noSetAside = setOf(LockReason.TAG_KEY_MISSING, LockReason.KEY_TRANSIENT)
        for (reason in LockReason.entries) {
            assertEquals(reason.name, reason !in noSetAside, reason.canSetAside())
        }
    }

    @Test fun everyLp1LockMapsToTheDemoLockOfTheSameName() {
        for (reason in LockReason.entries) assertEquals(reason.name, reason.toStoreLock().name)
    }

    @Test fun onlyKeyTransientAndOpenErrorAreRetryOnly() {
        for (lock in StoreLock.entries) assertEquals(lock.name, lock in retryOnly, lock.retryOnly)
    }

    /** The screen never suggests a reset or clearing storage for a retry-only lock, even if handed canReset = true. */
    @Test fun aLockedScreenForARetryOnlyLockSuggestsTryAgainOnly() {
        for (lock in StoreLock.entries) for (canReset in listOf(true, false)) {
            val expected = when {
                lock in retryOnly -> LockedRecovery.RETRY_ONLY
                canReset -> LockedRecovery.RESET
                else -> LockedRecovery.CLEAR_STORAGE
            }
            assertEquals("$lock canReset=$canReset", expected, DemoScreen.Locked(lock, canReset).recovery)
        }
    }
}
