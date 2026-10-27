package com.penningtonlabs.baileyscart.core.model

import org.junit.Assert.assertEquals
import org.junit.Test

class BuildContractTest {
    @Test
    fun workPackageIdentifierIsStable() {
        assertEquals("WP-00", BuildContract.WORK_PACKAGE)
    }
}
