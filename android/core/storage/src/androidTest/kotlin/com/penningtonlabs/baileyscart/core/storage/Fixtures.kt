package com.penningtonlabs.baileyscart.core.storage

import android.content.Context
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import com.penningtonlabs.baileyscart.core.model.offline.Category
import com.penningtonlabs.baileyscart.core.model.offline.FamilyEpoch
import com.penningtonlabs.baileyscart.core.model.offline.FamilyId
import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.ItemCommand
import com.penningtonlabs.baileyscart.core.model.offline.ItemId
import com.penningtonlabs.baileyscart.core.model.offline.ItemName
import com.penningtonlabs.baileyscart.core.model.offline.NameValidation
import com.penningtonlabs.baileyscart.core.model.offline.OpId
import com.penningtonlabs.baileyscart.core.model.offline.ServerErrorCode
import com.penningtonlabs.baileyscart.core.model.offline.Transition
import org.junit.Assert.assertTrue
import java.io.File
import java.security.MessageDigest
import java.util.UUID

/** All values are fictional. Sentinels are deliberately distinctive so byte scans are meaningful. */
object Fx {
    const val TAG = "BCSPIKE-EVIDENCE"
    const val SENTINEL_ITEM = "ZQXJ-SENTINEL-OATMILK-7731"
    const val SENTINEL_ITEM_2 = "ZQXJ-SENTINEL-PAPAYA-5519"
    const val SENTINEL_FAMILY = "demo-fam-ZQXJSENTINEL-4402"

    val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext

    fun evidence(line: String) {
        Log.i(TAG, line)
    }

    /** Fresh isolated root + alias prefix per test; keys and files are cleaned by [cleanup]. */
    class Env(name: String) {
        val id = UUID.randomUUID().toString().replace("-", "").take(10)
        val root = File(context.noBackupFilesDir, "spiketest/$name-$id")
        val prefix = "bcsp_${id}_"
        val keys = KeyManager(root, prefix)
        val recovery = RecoveryController(keys)

        fun open(uid: String): OpenResult = SpikeAccountStore.open(context, keys, FakeVerifiedSession(uid), recovery)

        fun opened(uid: String): SpikeAccountStore {
            val r = open(uid)
            assertTrue("expected Opened but was $r", r is OpenResult.Opened)
            return (r as OpenResult.Opened).store
        }

        fun tag(uid: String): AccountTag = keys.accountTag(FakeVerifiedSession(uid))!!

        fun cleanup() {
            keys.aliases().forEach { keys.deleteAlias(it) }
            root.deleteRecursively()
        }
    }

    fun family(store: SpikeAccountStore, fam: String = SENTINEL_FAMILY) = FamilyKey(store.account, FamilyId.of(fam)!!)

    fun name(s: String): ItemName = (ItemName.validate(s) as NameValidation.Valid).name

    private var counter = 0L

    /** Deterministic fictional UUID v4 values. */
    fun uuid(n: Long): String = "00000000-0000-4000-8000-%012x".format(n)

    fun opId(n: Long) = OpId.parse(uuid(n))!!
    fun itemId(n: Long) = ItemId.parse(uuid(0x100000 + n))!!
    fun nextOp(): OpId = opId(++counter + 0x200000)

    val E1: FamilyEpoch = FamilyEpoch.INITIAL
    val REJECT = ServerErrorCode("FAILED_PRECONDITION_TEST")

    fun applied(t: Transition): FamilyOutbox {
        assertTrue("expected Applied but was $t", t is Transition.Applied)
        return (t as Transition.Applied).outbox
    }

    fun add(o: FamilyOutbox, op: Long, item: Long, n: String, c: Category = Category.DAIRY) =
        o.enqueue(opId(op), o.key, E1, ItemCommand.Add(itemId(item), name(n), c))

    fun edit(o: FamilyOutbox, op: Long, item: Long, n: String) =
        o.enqueue(opId(op), o.key, E1, ItemCommand.Edit(itemId(item), name(n), null))

    fun files(store: File): List<File> = listOf(store, File(store.path + "-wal"), File(store.path + "-shm"), File(store.path + "-journal"))

    fun sha256(f: File): String = if (!f.exists()) "ABSENT" else MessageDigest.getInstance("SHA-256").digest(f.readBytes()).joinToString("") { "%02x".format(it) }

    fun hashes(files: List<File>): Map<String, String> = files.associate { it.name to sha256(it) }

    /** Byte scan for UTF-8, UTF-16LE and UTF-16BE encodings of [needle]. */
    fun containsAnyEncoding(haystack: ByteArray, needle: String): Boolean =
        listOf(Charsets.UTF_8, Charsets.UTF_16LE, Charsets.UTF_16BE).any { indexOf(haystack, needle.toByteArray(it)) >= 0 }

    fun indexOf(h: ByteArray, n: ByteArray): Int {
        if (n.isEmpty() || h.size < n.size) return -1
        outer@ for (i in 0..h.size - n.size) {
            for (j in n.indices) if (h[i + j] != n[j]) continue@outer
            return i
        }
        return -1
    }
}
