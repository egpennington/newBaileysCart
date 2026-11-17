package com.penningtonlabs.baileyscart.core.storage

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Resume finding F-5 probe (test-only; added 2026-11-08). Records what actually happens when two families
 * in one account hold the same opId. The outbox table has a GLOBAL unique index on opId and putOps uses
 * OnConflictStrategy.REPLACE; SQLite REPLACE deletes the pre-existing conflicting row.
 */
@RunWith(AndroidJUnit4::class)
class FindingProbeTest {
    private val envs = ArrayList<Fx.Env>()

    @After
    fun cleanup() = envs.forEach { it.cleanup() }

    @Test
    fun sameOpIdInAnotherFamilyMustNotDeleteFirstFamilyRows() {
        val e = Fx.Env("f5").also { envs += it }
        val s = e.opened("demo-f5")
        val k1 = Fx.family(s, "demo-fam-one")
        val k2 = Fx.family(s, "demo-fam-two")
        val o1 = Fx.applied(Fx.add(FamilyOutbox.empty(k1, Fx.E1), 1, 1, "Family one item"))
        check(s.stores.outbox.compareAndSet(k1, null, o1))
        val before = s.stores.outbox.read(k1)!!.operations.size
        val o2 = Fx.applied(Fx.add(FamilyOutbox.empty(k2, Fx.E1), 1, 2, "Family two item")) // same opId as family one
        val r = runCatching { s.stores.outbox.compareAndSet(k2, null, o2) }
        val after = s.stores.outbox.read(k1)!!.operations.size
        Fx.evidence("F5 family1 ops before=$before after=$after family2CAS=${r.getOrNull() ?: r.exceptionOrNull()?.javaClass?.simpleName}")
        s.close()
        assertEquals("family one's outbox rows must survive another family's write", before, after)
    }
}
