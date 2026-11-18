package com.penningtonlabs.baileyscart.demo.persist

import com.penningtonlabs.baileyscart.demo.showsGenericLockedBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * LP-2 reset hardening: a failed set-aside is "not started" only when the LP-1 recovery marker is
 * certainly absent, and the generic "nothing was deleted or replaced" body is hidden exactly when
 * a reset may have removed or moved the previous list.
 */
class ResetOutcomeTest {
    @Test fun aFailureWithThePendingMarkerPresentIsInterrupted() {
        assertEquals(SetAsideOutcome.INTERRUPTED, setAsideOutcomeAfterFailure { true })
    }

    /** Negative control: with the marker certainly absent, nothing can have moved. */
    @Test fun aFailureWithTheMarkerCertainlyAbsentIsNotStarted() {
        assertEquals(SetAsideOutcome.NOT_STARTED, setAsideOutcomeAfterFailure { false })
    }

    @Test fun aFailureWhoseMarkerCannotBeReadIsInterruptedNeverNotStarted() {
        assertEquals(SetAsideOutcome.INTERRUPTED, setAsideOutcomeAfterFailure { throw IOException("unreadable (test)") })
        assertEquals(SetAsideOutcome.INTERRUPTED, setAsideOutcomeAfterFailure { throw SecurityException("denied (test)") })
    }

    @Test fun theGenericLockedBodyIsHiddenOnlyForAnIncompleteReset() {
        assertFalse(showsGenericLockedBody(DemoNotice.RESET_INCOMPLETE))
        assertTrue(showsGenericLockedBody(null))
        assertTrue(showsGenericLockedBody(DemoNotice.RESET_FAILED))
        assertTrue(showsGenericLockedBody(DemoNotice.RESET_DONE))
    }
}
