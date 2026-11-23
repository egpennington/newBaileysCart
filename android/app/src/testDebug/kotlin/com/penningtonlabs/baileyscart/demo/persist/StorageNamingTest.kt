package com.penningtonlabs.baileyscart.demo.persist

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * BC-S2-LOCAL-PERSIST LP-3b: the :core:storage rename is name-only and keeps existing databases openable.
 * Classes are looked up without initialising them (AccountStore's static init loads native SQLCipher).
 */
class StorageNamingTest {
    private val pkg = "com.penningtonlabs.baileyscart.core.storage"

    private fun exists(simpleName: String): Boolean = try {
        Class.forName("$pkg.$simpleName", false, javaClass.classLoader)
        true
    } catch (_: ClassNotFoundException) {
        false
    }

    @Test
    fun theRenamedStorageClassesAndRoomsGeneratedDatabaseArePresent() {
        for (name in listOf("AccountStore", "AccountStorePorts", "AccountDao", "AccountDatabase", "AccountDatabase_Impl", "AccountDao_Impl")) {
            assertTrue("$name missing", exists(name))
        }
    }

    @Test
    fun noSpikeClassRemainsInTheStorageModule() {
        for (name in listOf("SpikeAccountStore", "SpikeStores", "SpikeDao", "SpikeDatabase", "SpikeDatabase_Impl", "SpikeCoordinator", "SpikeTransport")) {
            assertFalse("$name still present", exists(name))
        }
    }

    @Test
    fun theTestOnlyCoordinatorAndItsCrashPointsAreNotShippedInTheModule() {
        for (name in listOf("TestOutboxCoordinator", "TestTransport", "TransportResult", "CrashPoints")) {
            assertFalse("$name is in the production module", exists(name))
        }
    }

    /**
     * Room checks this hash against room_master_table on every open; a different hash would lock every existing
     * database. 45d66134... is the v3 hash exported by LP-1/LP-2/LP-3a (schemas/...SpikeDatabase/3.json).
     */
    @Test
    fun theExportedSchemaIdentityIsUnchangedByTheRename() {
        val schemas = File("../core/storage/schemas")
        assertTrue("schema directory not found from ${File(".").absolutePath}", schemas.isDirectory)
        assertEquals(listOf("$pkg.AccountDatabase"), schemas.list()!!.sorted())
        val dir = File(schemas, "$pkg.AccountDatabase")
        assertEquals(listOf("2.json", "3.json"), dir.list()!!.sorted())
        val v3 = File(dir, "3.json").readText()
        val hash = Regex("\"identityHash\": \"([0-9a-f]+)\"").find(v3)?.groupValues?.get(1)
        assertEquals("45d6613426ecb55fa9fe5b96c39ae013", hash)
        assertTrue(Regex("\"version\": 3,").containsMatchIn(v3))
        val v2 = File(dir, "2.json").readText()
        assertTrue(v2.contains("\"identityHash\": \"ef02cea35459ef1d94811840a88d28e5\""))
    }
}
