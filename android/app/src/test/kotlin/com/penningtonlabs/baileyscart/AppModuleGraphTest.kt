package com.penningtonlabs.baileyscart

import com.penningtonlabs.baileyscart.core.model.BuildContract
import org.junit.Assert.assertEquals
import org.junit.Test

class AppModuleGraphTest {
    @Test
    fun appResolvesCoreModelModule() {
        assertEquals("WP-00", BuildContract.WORK_PACKAGE)
    }
}
