package com.penningtonlabs.baileyscart.demo.persist

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import java.io.IOException
import javax.xml.parsers.DocumentBuilderFactory

/**
 * LP-2 reset hardening: a failed set-aside is "not started" only when the LP-1 recovery marker is
 * certainly absent, and the locked-screen copy is the PL-approved wording that stays true for every
 * lock (first failure, unfinished reset, restart).
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

    @Test fun theLockedScreenCopyIsThePlApprovedWording() {
        val strings = debugStrings()
        assertEquals(
            "The saved demo list is unavailable. You can try again. If the problem continues, you may be able to reset the demo list.",
            strings["demo_locked_body"],
        )
        assertEquals(
            "Reset didn't finish. The previous demo list is no longer active, and a new list couldn't be started.",
            strings["demo_notice_reset_incomplete"],
        )
        // The body is shown with every lock, so it must not claim what is unknown after a reset.
        val body = strings.getValue("demo_locked_body").lowercase()
        for (claim in listOf("deleted", "replaced", "removed", "nothing")) assertFalse(claim, claim in body)
    }

    /** LP-3c: KEY_TRANSIENT and OPEN_ERROR use the approved neutral wording: no reset or clear-storage advice, no claims. */
    @Test fun theTemporaryLockCopyIsTheApprovedNeutralWording() {
        val strings = debugStrings()
        assertEquals(
            "We couldn't open your saved demo list. Try again. If the problem continues, restart the app or device.",
            strings["demo_locked_retry_body"],
        )
        val body = strings.getValue("demo_locked_retry_body").lowercase()
        for (claim in listOf("reset", "clear", "storage", "delete", "nothing", "changed", "temporary")) {
            assertFalse(claim, claim in body)
        }
    }

    private fun debugStrings(): Map<String, String> {
        val path = "src/debug/res/values/strings.xml"
        val file = listOf(File(path), File("app/$path")).first { it.isFile }
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file)
        val nodes = doc.getElementsByTagName("string")
        return (0 until nodes.length).associate { i ->
            val e = nodes.item(i) as Element
            e.getAttribute("name") to e.textContent.replace("\\'", "'")
        }
    }
}
