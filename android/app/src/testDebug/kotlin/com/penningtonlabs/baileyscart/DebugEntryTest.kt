package com.penningtonlabs.baileyscart

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** BC-UI-S1 (PL-PP-WP01-04): the debug build routes to the LOCAL DEMO. */
class DebugEntryTest {
    @Test
    fun debugEntryEnablesLocalDemo() {
        assertTrue(AppEntry.LOCAL_DEMO_ENABLED)
        assertNotNull(Class.forName("com.penningtonlabs.baileyscart.demo.LocalDemoList"))
    }
}
