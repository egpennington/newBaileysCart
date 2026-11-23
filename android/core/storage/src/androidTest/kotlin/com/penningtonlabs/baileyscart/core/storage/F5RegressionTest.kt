package com.penningtonlabs.baileyscart.core.storage

import android.database.sqlite.SQLiteConstraintException
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.penningtonlabs.baileyscart.core.model.offline.AddOutcome
import com.penningtonlabs.baileyscart.core.model.offline.Category
import com.penningtonlabs.baileyscart.core.model.offline.Dispatch
import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutboxRestore
import com.penningtonlabs.baileyscart.core.model.offline.ItemCommand
import com.penningtonlabs.baileyscart.core.model.offline.OpState
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

/**
 * F-5 regression (PL-authorized repair, 2026-11-08): per-family (familyId, opId) uniqueness, fail-closed ABORT
 * inserts, explicit family-scoped UPDATEs, whole-CAS rollback. Every collection assertion is preceded by an
 * exact count/identity assertion so an empty result cannot pass.
 */
@RunWith(AndroidJUnit4::class)
class F5RegressionTest {
    private val envs = ArrayList<Fx.Env>()
    private fun env(name: String) = Fx.Env(name).also { envs += it }

    @After
    fun cleanup() = envs.forEach { it.cleanup() }

    private fun keyOf(e: Fx.Env, s: AccountStore) = (e.keys.unwrap(s.tag) as UnwrapResult.Ok).key

    /** Two ops (opIds 1 and 2) with family-specific names. */
    private fun seedTwo(s: AccountStore, key: FamilyKey, label: String): FamilyOutbox {
        val o1 = Fx.applied(Fx.add(FamilyOutbox.empty(key, Fx.E1), 1, 1, "$label item one"))
        assertTrue(s.stores.outbox.compareAndSet(key, null, o1))
        val o2 = Fx.applied(Fx.add(o1, 2, 2, "$label item two", Category.PRODUCE))
        assertTrue(s.stores.outbox.compareAndSet(key, o1, o2))
        return o2
    }

    private fun scopeRev(s: AccountStore, fam: String): Long =
        s.supportDb().query("SELECT rev FROM family_scope WHERE familyId = ?", arrayOf(fam)).use { if (it.moveToFirst()) it.getLong(0) else -1L }

    @Test
    fun sameOpIdsInTwoFamiliesPreserveBothFamiliesExactly() {
        val e = env("f5a")
        val s = e.opened("demo-f5a")
        val ka = Fx.family(s, "demo-fam-a")
        val kb = Fx.family(s, "demo-fam-b")
        val oa = seedTwo(s, ka, "A")
        val km = keyOf(e, s)
        val dbFile = e.keys.dbFile(s.tag)
        val aBefore = MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey, "demo-fam-a")
        assertEquals("non-vacuous: family A has 2 rows before", 2, aBefore.size)
        val ob = seedTwo(s, kb, "B") // SAME opIds 1 and 2
        val aAfter = MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey, "demo-fam-a")
        val bAfter = MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey, "demo-fam-b")
        km.wipe()
        assertEquals("family A rows byte-for-byte unchanged by family B writes", aBefore, aAfter)
        assertEquals("family B has exactly its own 2 rows", 2, bAfter.size)
        assertEquals(listOf(Fx.uuid(1), Fx.uuid(2)), bAfter.map { it[2] })
        assertEquals(listOf("demo-fam-b", "demo-fam-b"), bAfter.map { it[0] })
        assertEquals(oa, s.stores.outbox.read(ka))
        assertEquals(ob, s.stores.outbox.read(kb))
        assertEquals("B item one", ((s.stores.outbox.read(kb)!!.operations[0].command) as ItemCommand.Add).name.display)
        assertEquals("A item one", ((s.stores.outbox.read(ka)!!.operations[0].command) as ItemCommand.Add).name.display)
        s.close()
        // Reopen (file-backed) and recheck.
        val s2 = e.opened("demo-f5a")
        assertEquals(oa, s2.stores.outbox.read(ka))
        assertEquals(ob, s2.stores.outbox.read(kb))
        s2.close()
        Fx.evidence("F5 sameOpIds: A rows unchanged (2/2), B rows 2/2 own payloads; preserved across reopen")
    }

    @Test
    fun familyBInsertUpdateRejectRevokeWithCollidingOpIdsNeverTouchesFamilyA() {
        val e = env("f5b")
        val s = e.opened("demo-f5b")
        val ka = Fx.family(s, "demo-fam-a")
        val kb = Fx.family(s) // the Scenario family; uses opIds 1..4
        // Family A holds opIds 1..4 too (different payloads), all unsent.
        var oa: FamilyOutbox? = null
        for (i in 1L..4L) {
            val next = Fx.applied(Fx.add(oa ?: FamilyOutbox.empty(ka, Fx.E1), i, 100 + i, "A-only $i"))
            assertTrue(s.stores.outbox.compareAndSet(ka, oa, next))
            oa = next
        }
        val km = keyOf(e, s)
        val dbFile = e.keys.dbFile(s.tag)
        val aBefore = MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey, "demo-fam-a")
        assertEquals(4, aBefore.size)
        var checks = 0
        val c = TestOutboxCoordinator(s.stores.outbox, kb, null, Fx.E1, { op ->
            assertEquals("A unchanged at send ${op.opId.value}", aBefore, MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey, "demo-fam-a"))
            checks++
            Scenario.RESULTS.getValue(op.opId.value)
        })
        Scenario.enqueueAll(c) { }
        c.drain() // B: op1 rejected, op2 BLOCKED, op3/op4 committed (state UPDATEs on colliding opIds)
        c.apply(c.outbox.revoke(), "revoke B")
        assertEquals("B sent op1, op3, op4", 3, checks)
        val aAfter = MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey, "demo-fam-a")
        val bAfter = MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey, Fx.SENTINEL_FAMILY)
        km.wipe()
        assertEquals("family A byte-identical after B insert/update/reject/revoke", aBefore, aAfter)
        assertEquals(4, bAfter.size)
        assertEquals(listOf("REJECTED_TERMINAL", "BLOCKED_DEPENDENCY", "COMMITTED", "COMMITTED"), bAfter.map { it[9] })
        assertEquals(oa, s.stores.outbox.read(ka))
        assertEquals(OpState.PENDING, s.stores.outbox.read(ka)!!.operations.single { it.opId == Fx.opId(1) }.state)
        // Another account sees neither family.
        val other = e.opened("demo-f5b-other")
        assertNull(other.stores.outbox.read(Fx.family(other, "demo-fam-a")))
        assertNull(other.stores.outbox.read(Fx.family(other)))
        other.close()
        s.close()
        Fx.evidence("F5 lifecycle: B insert+IN_FLIGHT+reject+blocked+commit+revoke on opIds 1..4; A 4/4 rows byte-identical at every send and after")
    }

    @Test
    fun immutableIdentityChangeInSameFamilyFailsAndRollsBackWholeCas() {
        val e = env("f5c")
        val s = e.opened("demo-f5c")
        val k = Fx.family(s, "demo-fam-a")
        val o1 = Fx.applied(Fx.add(FamilyOutbox.empty(k, Fx.E1), 1, 1, "Original name"))
        assertTrue(s.stores.outbox.compareAndSet(k, null, o1))
        val km = keyOf(e, s)
        val dbFile = e.keys.dbFile(s.tag)
        val before = MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey)
        val revBefore = scopeRev(s, "demo-fam-a")
        assertEquals(1, before.size)
        // Same opId, different payload, plus a brand-new op in the same CAS.
        val tampered = o1.operations.map { it.copy(command = ItemCommand.Add(Fx.itemId(1), Fx.name("Tampered name"), Category.DAIRY)) }
        val withNew = (FamilyOutbox.restore(k, Fx.E1, o1.access, tampered) as FamilyOutboxRestore.Restored).outbox
        val updated = Fx.applied(Fx.add(withNew, 2, 2, "Should not persist"))
        try {
            s.stores.outbox.compareAndSet(k, o1, updated)
            fail("identity/payload change must not succeed")
        } catch (_: CasConflictException) {
        }
        assertEquals("whole CAS rolled back (no op2, no payload change)", before, MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey))
        assertEquals("scope rev rolled back", revBefore, scopeRev(s, "demo-fam-a"))
        // Stale expected -> false, nothing written.
        assertFalse(s.stores.outbox.compareAndSet(k, null, o1))
        assertEquals(before, MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey))
        // The legitimate CAS still works afterwards.
        val legit = Fx.applied(Fx.add(o1, 2, 2, "Legit second"))
        assertTrue(s.stores.outbox.compareAndSet(k, o1, legit))
        assertEquals(2, MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey).size)
        km.wipe()
        s.close()
        Fx.evidence("F5 same-family identity conflict: CasConflictException; rows+scope rev rolled back; stale CAS=false; legit CAS ok")
    }

    @Test
    fun uniquenessConflictAbortsWholeCasAndSurvivesRestartWithoutDoubleEffect() {
        val e = env("f5d")
        val s = e.opened("demo-f5d")
        val k = Fx.family(s, "demo-fam-a")
        val o1 = Fx.applied(Fx.add(FamilyOutbox.empty(k, Fx.E1), 1, 1, "Committed one"))
        assertTrue(s.stores.outbox.compareAndSet(k, null, o1))
        val km = keyOf(e, s)
        val dbFile = e.keys.dbFile(s.tag)
        val before = MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey)
        val revBefore = scopeRev(s, "demo-fam-a")
        assertEquals(1, before.size)
        val updated = Fx.applied(Fx.add(o1, 2, 2, "New two"))
        // Inside the CAS transaction (after compare, before writes) an out-of-band row claims (familyId, opId 2).
        s.stores.txnHook = TxnHook { label ->
            if (label == "cas-pre-write") {
                s.supportDb().execSQL(
                    "INSERT INTO outbox (familyId, sequence, opId, epoch, kind, itemId, state, dispatched, attempts) VALUES (?,?,?,?,?,?,?,?,?)",
                    arrayOf<Any>("demo-fam-a", 99L, Fx.uuid(2), 1L, "ADD", Fx.uuid(0x100099), "PENDING", 0, 0),
                )
            }
        }
        try {
            s.stores.outbox.compareAndSet(k, o1, updated)
            fail("a (familyId, opId) uniqueness conflict must abort the CAS")
        } catch (ex: SQLiteConstraintException) {
            Fx.evidence("F5 abort: ${ex.javaClass.simpleName}")
        }
        s.stores.txnHook = TxnHook { }
        assertEquals("ABORT rolled back every write incl. the conflicting row and scope rev", before, MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey))
        assertEquals(revBefore, scopeRev(s, "demo-fam-a"))
        s.close()
        // Process-restart equivalent: reopen, prior committed state intact, retry once, no double effect.
        val s2 = e.opened("demo-f5d")
        assertEquals(o1, s2.stores.outbox.read(k))
        assertTrue(s2.stores.outbox.compareAndSet(k, o1, updated))
        val rows = MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey)
        km.wipe()
        assertEquals(2, rows.size)
        assertEquals(1, rows.count { it[2] == Fx.uuid(2) })
        assertTrue(rows.none { it[1] == "99" })
        s2.close()
        Fx.evidence("F5 abort: rows 1/1 and rev unchanged after conflict; after reopen retry -> 2 rows, opId2 exactly once")
    }

    @Test
    fun runtimeSchemaHasFamilyScopedUniqueOpIdIndexAndNoGlobalOne() {
        val e = env("f5e")
        val s = e.opened("demo-f5e")
        val db = s.supportDb()
        val indexes = db.query("PRAGMA index_list('outbox')").use { c ->
            buildList { while (c.moveToNext()) add(Triple(c.getString(c.getColumnIndexOrThrow("name")), c.getInt(c.getColumnIndexOrThrow("unique")), c.getString(c.getColumnIndexOrThrow("origin")))) }
        }
        val cols = indexes.associate { (name, _, _) -> name to db.query("PRAGMA index_info('$name')").use { c -> buildList { while (c.moveToNext()) add(c.getString(c.getColumnIndexOrThrow("name"))) } } }
        Fx.evidence("F5 schema outbox indexes=" + indexes.joinToString { "${it.first}(unique=${it.second},origin=${it.third},cols=${cols[it.first]})" })
        assertTrue("non-vacuous: outbox has indexes", indexes.isNotEmpty())
        assertTrue("unique (familyId, opId) index present", indexes.any { it.second == 1 && cols[it.first] == listOf("familyId", "opId") })
        assertFalse("no account-wide unique opId index", indexes.any { it.second == 1 && cols[it.first] == listOf("opId") })
        val version = db.query("PRAGMA user_version").use { it.moveToFirst(); it.getInt(0) }
        assertEquals(AccountDatabase.VERSION, version)
        s.close()
    }

    @Test
    fun v2MultiFamilyStoreMigratesToV3PreservingEveryRowThenAcceptsCollidingOpIds() {
        val e = env("f5f")
        val uid = "demo-f5f"
        val tag = e.tag(uid)
        val km = e.keys.create(tag)
        val acct = com.penningtonlabs.baileyscart.core.model.offline.AccountKey.of(tag.hex)!!
        val ka = FamilyKey(acct, com.penningtonlabs.baileyscart.core.model.offline.FamilyId.of("demo-fam-a")!!)
        val kb = FamilyKey(acct, com.penningtonlabs.baileyscart.core.model.offline.FamilyId.of("demo-fam-b")!!)
        // Family A: op1 rejected -> op2 blocked, op3 in flight, op4 pending.
        var a = FamilyOutbox.empty(ka, Fx.E1)
        a = Fx.applied(Fx.add(a, 1, 1, "Mig A one"))
        a = Fx.applied(Fx.edit(a, 2, 1, "Mig A one edited"))
        a = Fx.applied(Fx.add(a, 3, 2, "Mig A two", Category.FROZEN))
        a = Fx.applied(Fx.add(a, 4, 3, "Mig A three", Category.MEAT))
        a = (a.dispatchNext() as Dispatch.Send).outbox
        a = Fx.applied(a.recordRejected(ka, Fx.opId(1), Fx.REJECT))
        a = (a.dispatchNext() as Dispatch.Send).outbox
        // Family B: distinct opIds (v2's global index forbade equal ones), one committed, one pending.
        var b = FamilyOutbox.empty(kb, Fx.E1)
        b = Fx.applied(Fx.add(b, 11, 11, "Mig B one"))
        b = Fx.applied(Fx.add(b, 12, 12, "Mig B two"))
        b = (b.dispatchNext() as Dispatch.Send).outbox
        b = Fx.applied(b.recordCommitted(kb, Fx.opId(11), 7, AddOutcome.CREATED))
        val dbFile = e.keys.dbFile(tag)
        MigrationFixture.writeV2(dbFile, km.sqlcipherKey, listOf(a, b))
        val v2Rows = MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey)
        assertEquals("non-vacuous: 6 rows in 2 families before migration", 6, v2Rows.size)
        val s = e.opened(uid) // migrates 2 -> 3
        assertEquals("every row, every column preserved by v2->v3", v2Rows, MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey))
        val expectedA = (FamilyOutbox.restore(ka, a.currentEpoch, a.access, a.operations) as FamilyOutboxRestore.Restored).outbox
        assertEquals(expectedA, s.stores.outbox.read(ka))
        assertEquals(b, s.stores.outbox.read(kb))
        assertEquals("Mig snapshot 0", s.stores.list.read(ka)!!.items.single().name)
        // After the repair, B may now hold an opId equal to one of A's.
        val bNext = Fx.applied(Fx.add(b, 1, 50, "B reuses A's opId 1"))
        assertTrue(s.stores.outbox.compareAndSet(kb, b, bNext))
        val after = MigrationFixture.rawOutbox(dbFile, km.sqlcipherKey)
        km.wipe()
        assertEquals(7, after.size)
        assertEquals("A rows unchanged", v2Rows.filter { it[0] == "demo-fam-a" }, after.filter { it[0] == "demo-fam-a" })
        assertEquals(2, after.count { it[2] == Fx.uuid(1) })
        s.close()
        Fx.evidence("F5 migration v2->v3: 6/6 rows (2 families) byte-identical incl. REJECTED/BLOCKED/IN_FLIGHT/COMMITTED; then colliding opId accepted in B; A unchanged")
    }

    @Test
    fun failingV2ToV3MigrationLocksWithoutDataLoss() {
        val e = env("f5g")
        val uid = "demo-f5g"
        val tag = e.tag(uid)
        val km = e.keys.create(tag)
        val acct = com.penningtonlabs.baileyscart.core.model.offline.AccountKey.of(tag.hex)!!
        val ka = FamilyKey(acct, com.penningtonlabs.baileyscart.core.model.offline.FamilyId.of("demo-fam-a")!!)
        val a = Fx.applied(Fx.add(FamilyOutbox.empty(ka, Fx.E1), 1, 1, "Must survive"))
        val dbFile = e.keys.dbFile(tag)
        MigrationFixture.writeV2(dbFile, km.sqlcipherKey, listOf(a), omitSnapshotHeader = true) // v3 validation must fail
        km.wipe()
        val before = Fx.hashes(listOf(dbFile, e.keys.dekFile(tag)))
        assertEquals(OpenResult.Locked(LockReason.MIGRATION_FAILED), e.open(uid))
        assertEquals(OpenResult.Locked(LockReason.MIGRATION_FAILED), e.open(uid))
        assertEquals("no destructive fallback: db + dek byte-identical", before, Fx.hashes(listOf(dbFile, e.keys.dekFile(tag))))
        assertFalse(e.keys.createdMarker(tag).exists())
        val km2 = (e.keys.unwrap(tag) as UnwrapResult.Ok).key
        val rows = MigrationFixture.rawOutbox(dbFile, km2.sqlcipherKey)
        km2.wipe()
        assertEquals("the unsent op is still there", 1, rows.size)
        assertEquals(Fx.uuid(1), rows.single()[2])
        Fx.evidence("F5 failing migration v2->v3: LOCKED(MIGRATION_FAILED) x2; db+dek identical; 1/1 row retained")
    }
}
