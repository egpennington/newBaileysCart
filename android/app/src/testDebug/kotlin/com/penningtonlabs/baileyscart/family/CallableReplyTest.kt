package com.penningtonlabs.baileyscart.family

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * BC-FAMILY-SYNC-01 Step 2: only an API v0.4 rejection envelope is a server decision. Transport
 * failures, timeouts and replies without an envelope must never look like a revocation.
 */
class CallableReplyTest {
    private val parseRev: (Map<*, *>) -> Long = { (it["rev"] as Number).toLong() }

    private fun rejection(code: String, retryable: Boolean, status: String = "NOT_FOUND") = mapOf(
        "error" to mapOf(
            "status" to status,
            "message" to "x",
            "details" to mapOf("apiVersion" to "v0.4", "status" to "REJECTED", "error" to mapOf("code" to code, "retryable" to retryable)),
        ),
    )

    @Test
    fun committedEnvelopeIsOk() {
        val reply = mapOf("result" to mapOf("status" to "COMMITTED", "data" to mapOf("rev" to 3)))
        assertEquals(CallResult.Ok(3L), EmulatorBackend.resultOf(200, reply, parseRev))
    }

    @Test
    fun rejectionEnvelopeCarriesTheDomainCode() {
        assertEquals(CallResult.Rejected("MEMBERSHIP_REVOKED", false), EmulatorBackend.resultOf(403, rejection("MEMBERSHIP_REVOKED", false), parseRev))
        assertEquals(CallResult.Rejected("ITEM_DELETED", false), EmulatorBackend.resultOf(400, rejection("ITEM_DELETED", false), parseRev))
        assertEquals(CallResult.Unauthenticated, EmulatorBackend.resultOf(401, rejection("UNAUTHENTICATED", false, "UNAUTHENTICATED"), parseRev))
    }

    @Test
    fun noEnvelopeIsNeverADecision() {
        assertEquals(CallResult.Unreachable, EmulatorBackend.resultOf(503, null, parseRev))
        assertEquals(CallResult.Unreachable, EmulatorBackend.resultOf(500, mapOf("error" to mapOf("status" to "INTERNAL")), parseRev))
        assertEquals(CallResult.Unreachable, EmulatorBackend.resultOf(404, mapOf("error" to mapOf("status" to "NOT_FOUND")), parseRev))
        assertEquals(CallResult.Unauthenticated, EmulatorBackend.resultOf(401, mapOf("error" to mapOf("status" to "UNAUTHENTICATED")), parseRev))
        assertEquals(CallResult.Unreachable, EmulatorBackend.resultOf(200, mapOf("unexpected" to 1), parseRev))
    }

    @Test
    fun aMalformedSuccessIsATerminalClientRejectionNotAnAck() {
        val reply = mapOf("result" to mapOf("data" to mapOf("rev" to "three")))
        assertEquals(CallResult.Rejected("CLIENT_PARSE_FAILED", false), EmulatorBackend.resultOf(200, reply, parseRev))
    }
}
