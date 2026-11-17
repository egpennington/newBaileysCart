package com.penningtonlabs.baileyscart.core.storage

import android.content.Context
import android.database.sqlite.SQLiteException
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import com.penningtonlabs.baileyscart.core.model.offline.AccountKey
import net.zetetic.database.DatabaseErrorHandler
import net.zetetic.database.sqlcipher.SQLiteConnection
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SQLiteDatabaseHook
import net.zetetic.database.sqlcipher.SQLiteGlobal
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList

enum class LockReason {
    TAG_KEY_MISSING,
    KEY_MISSING,
    UNWRAP_FAILED,
    KEY_TRANSIENT,
    DB_MISSING,
    DB_UNREADABLE,
    MIGRATION_FAILED,
    DOWNGRADE,
    RECOVERY_PENDING,
}

sealed interface OpenResult {
    class Opened(val store: SpikeAccountStore) : OpenResult
    data class Locked(val reason: LockReason) : OpenResult
}

/** synchronous was not FULL on the connection that is about to commit. The transaction is rolled back. */
class DurabilityViolationException(observed: Long) : IllegalStateException("synchronous=$observed, FULL(2) required")

/** Observations recorded by the connection hook (test evidence). Holds connection references, test use only. */
object ConnectionRegistry {
    class Observed(val connection: SQLiteConnection, val synchronousAfterHook: Long, val tempStore: String, val secureDelete: String)

    val connections = CopyOnWriteArrayList<Observed>()
}

/**
 * One synthetic account's encrypted store. Created only through [open]; never re-creates or replaces
 * an existing database or key after an error (preserve by default).
 */
class SpikeAccountStore private constructor(
    val tag: AccountTag,
    private val db: SpikeDatabase,
    private val key: KeyMaterial,
    val account: AccountKey,
) {
    @Volatile private var closed = false

    val stores = SpikeStores(account, { _, block -> writeTxn(block) }, db.dao())

    val keyAlias: String get() = key.alias

    /** Test evidence only. */
    fun keyFingerprint(): String = key.fingerprint()

    internal fun supportDb(): SupportSQLiteDatabase = db.openHelper.writableDatabase

    /**
     * Run [block] in one write transaction on the writer connection. SQLite forbids changing the safety
     * level inside a transaction, so FULL is (re)applied immediately before BEGIN (a non-read-only statement
     * runs on the primary/writer connection) and then ASSERTED inside the transaction; because it cannot
     * change inside the transaction, the assertion proves the commit runs with synchronous=FULL.
     */
    private fun writeTxn(block: () -> Unit) {
        check(!closed) { "store closed" }
        supportDb().execSQL("PRAGMA synchronous=FULL")
        db.runInTransaction {
            assertFull(supportDb())
            block()
        }
    }

    /** Synchronous mode observed on the writer connection inside a transaction (test evidence). */
    fun writerSynchronousInTransaction(): Long {
        var v = -1L
        db.runInTransaction { v = pragmaLong(supportDb(), "PRAGMA synchronous") }
        return v
    }

    fun journalMode(): String = supportDb().query("PRAGMA journal_mode").use { it.moveToFirst(); it.getString(0) }

    fun isClosed(): Boolean = closed

    fun keyWiped(): Boolean = key.isWiped()

    /** Close the database, then wipe the in-memory key material. Files are never touched. */
    fun close() {
        if (closed) return
        closed = true
        db.close()
        key.wipe()
    }

    override fun toString(): String = "SpikeAccountStore(<redacted>)"

    companion object {
        init {
            System.loadLibrary("sqlcipher")
            // DUR-1 (verified on device): SQLCipher's SQLiteConnection.open() forces synchronous=NORMAL via
            // setWalModeFromConfiguration() on EVERY pooled connection (writer and secondary readers) after the
            // key hook. Room exposes no per-connection callback for secondaries, so the spike uses a single-
            // connection WAL pool: the only connection is the writer, which onConfigure and every write
            // transaction hold at FULL. Trade-off: no concurrent readers (serialized reads).
            SQLiteGlobal.setWALConnectionPoolSize(1)
        }

        /** Loaded native SQLCipher; call before any direct SQLCipher use in tests. */
        fun ensureNativeLoaded() = Unit

        fun open(context: Context, keys: KeyManager, session: FakeVerifiedSession, recovery: RecoveryController): OpenResult {
            val tag = keys.accountTag(session) ?: return OpenResult.Locked(LockReason.TAG_KEY_MISSING)
            if (recovery.pending(tag)) return OpenResult.Locked(LockReason.RECOVERY_PENDING)
            val dbFile = keys.dbFile(tag)
            val dekExists = keys.dekFile(tag).exists()
            val created = keys.createdMarker(tag).exists()
            val key: KeyMaterial = when {
                !dbFile.exists() && !dekExists -> {
                    if (created) return OpenResult.Locked(LockReason.DB_MISSING)
                    keys.create(tag)
                }
                !dbFile.exists() && created -> return OpenResult.Locked(LockReason.DB_MISSING)
                else -> when (val r = keys.unwrap(tag)) {
                    is UnwrapResult.Ok -> r.key
                    UnwrapResult.KeyMissing -> return OpenResult.Locked(LockReason.KEY_MISSING)
                    UnwrapResult.UnwrapFailed -> return OpenResult.Locked(LockReason.UNWRAP_FAILED)
                    UnwrapResult.Transient -> return OpenResult.Locked(LockReason.KEY_TRANSIENT)
                }
            }
            var storedVersion = 0L
            if (dbFile.exists()) {
                when (val p = preflight(dbFile, key.sqlcipherKey)) {
                    is Probe.Fail -> {
                        key.wipe()
                        return OpenResult.Locked(p.reason)
                    }
                    is Probe.Ok -> storedVersion = p.userVersion
                }
            }
            val db = try {
                Room.databaseBuilder(context, SpikeDatabase::class.java, dbFile.absolutePath)
                    .openHelperFactory(FullSyncOpenHelperFactory(SupportOpenHelperFactory(key.sqlcipherKey, Hook, true)))
                    .addMigrations(SpikeDatabase.MIGRATION_1_2, SpikeDatabase.MIGRATION_2_3)
                    .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING)
                    .build()
            } catch (e: RuntimeException) {
                key.wipe()
                throw e
            }
            try {
                db.openHelper.writableDatabase // forces create / migrate / validate now, not lazily
            } catch (e: RuntimeException) {
                db.close()
                key.wipe()
                return OpenResult.Locked(
                    if (storedVersion in 1 until SpikeDatabase.VERSION) LockReason.MIGRATION_FAILED else classifyOpenFailure(e),
                )
            }
            if (!created) KeyManager.writeAtomically(keys.createdMarker(tag), byteArrayOf(1))
            return OpenResult.Opened(SpikeAccountStore(tag, db, key, AccountKey.of(tag.hex)!!))
        }

        private fun classifyOpenFailure(e: Throwable): LockReason {
            val msg = generateSequence(e) { it.cause }.mapNotNull { it.message }.joinToString(" ").lowercase()
            return if ("migration" in msg) LockReason.MIGRATION_FAILED else LockReason.DB_UNREADABLE
        }

        sealed interface Probe {
            data class Ok(val userVersion: Long) : Probe
            data class Fail(val reason: LockReason) : Probe
        }

        /**
         * Non-mutating preflight. The ORIGINAL files are never opened: the database and any -wal are copied
         * into a private probe directory and the copy is opened read-only with a throwing, never-deleting
         * error handler (cipher integrity, SQLite quick_check, schema version). Opening even read-only would
         * otherwise create -wal/-shm beside a locked database. Only the probe copy is ever removed.
         */
        fun preflight(dbFile: File, sqlcipherKey: ByteArray): Probe {
            val probeDir = File(dbFile.parentFile, ".probe").apply { mkdirs() }
            probeDir.listFiles()?.forEach { it.delete() } // previous probe copies only (never account files)
            val copy = File(probeDir, dbFile.name)
            try {
                dbFile.copyTo(copy)
                File(dbFile.path + "-wal").takeIf { it.exists() }?.copyTo(File(copy.path + "-wal"))
                return probeCopy(copy, sqlcipherKey)
            } finally {
                probeDir.listFiles()?.forEach { it.delete() }
            }
        }

        private fun probeCopy(copy: File, sqlcipherKey: ByteArray): Probe {
            val probe = try {
                SQLiteDatabase.openDatabase(copy.absolutePath, sqlcipherKey, null, SQLiteDatabase.OPEN_READONLY, ThrowingErrorHandler, null)
            } catch (_: RuntimeException) {
                return Probe.Fail(LockReason.DB_UNREADABLE)
            }
            return try {
                val cipherErrors = probe.rawQuery("PRAGMA cipher_integrity_check", null).use { it.count }
                val quick = probe.rawQuery("PRAGMA quick_check", null).use { c -> if (c.moveToFirst()) c.getString(0) else "" }
                val version = probe.rawQuery("PRAGMA user_version", null).use { c -> if (c.moveToFirst()) c.getLong(0) else -1L }
                when {
                    cipherErrors != 0 || quick != "ok" -> Probe.Fail(LockReason.DB_UNREADABLE)
                    version > SpikeDatabase.VERSION -> Probe.Fail(LockReason.DOWNGRADE)
                    else -> Probe.Ok(version)
                }
            } catch (_: RuntimeException) {
                Probe.Fail(LockReason.DB_UNREADABLE)
            } finally {
                runCatching { probe.close() }
            }
        }

        internal fun pragmaLong(db: SupportSQLiteDatabase, sql: String): Long = db.query(sql).use { it.moveToFirst(); it.getLong(0) }

        internal fun assertFull(db: SupportSQLiteDatabase) {
            val v = pragmaLong(db, "PRAGMA synchronous")
            if (v != 2L) throw DurabilityViolationException(v)
        }
    }

    /** Throws on corruption; never deletes, renames or recreates files. */
    object ThrowingErrorHandler : DatabaseErrorHandler {
        @Volatile var invocations = 0

        override fun onCorruption(dbObj: SQLiteDatabase, exception: SQLiteException) {
            invocations++
            throw IllegalStateException("database corruption detected; preserved untouched", exception)
        }
    }

    /**
     * Per-connection settings. NOTE (verified in 4.20.0 bytecode): SQLiteConnection.open() calls
     * postKey() BEFORE setWalModeFromConfiguration(), which forces SQLiteGlobal.getWALSyncMode()
     * ("normal") on the non-read-only (writer) connection. So postKey alone cannot guarantee FULL on the
     * writer; [FullSyncOpenHelperFactory] re-applies it in onConfigure, and every write transaction
     * re-asserts it (fail closed).
     */
    private object Hook : SQLiteDatabaseHook {
        override fun preKey(connection: SQLiteConnection) = Unit

        override fun postKey(connection: SQLiteConnection) {
            connection.execute("PRAGMA temp_store=MEMORY", null, null)
            val secureDelete = connection.executeForString("PRAGMA secure_delete=ON", null, null) ?: ""
            connection.execute("PRAGMA synchronous=FULL", null, null)
            ConnectionRegistry.connections += ConnectionRegistry.Observed(
                connection,
                connection.executeForLong("PRAGMA synchronous", null, null),
                connection.executeForString("PRAGMA temp_store", null, null) ?: "",
                secureDelete,
            )
        }
    }
}

/**
 * Wraps the SQLCipher factory so that onConfigure (after SQLCipher's connection configuration, before
 * any schema write) sets synchronous=FULL on the writer, and so that corruption is never handled by
 * deleting the database (androidx default onCorruption deletes files).
 */
class FullSyncOpenHelperFactory(private val delegate: SupportSQLiteOpenHelper.Factory) : SupportSQLiteOpenHelper.Factory {
    override fun create(configuration: SupportSQLiteOpenHelper.Configuration): SupportSQLiteOpenHelper {
        val inner = configuration.callback
        val callback = object : SupportSQLiteOpenHelper.Callback(inner.version) {
            override fun onConfigure(db: SupportSQLiteDatabase) {
                db.execSQL("PRAGMA synchronous=FULL")
                inner.onConfigure(db)
            }

            override fun onCreate(db: SupportSQLiteDatabase) = inner.onCreate(db)
            override fun onUpgrade(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) = inner.onUpgrade(db, oldVersion, newVersion)
            override fun onDowngrade(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) = inner.onDowngrade(db, oldVersion, newVersion)
            override fun onOpen(db: SupportSQLiteDatabase) = inner.onOpen(db)
            override fun onCorruption(db: SupportSQLiteDatabase) {
                throw IllegalStateException("database corruption detected; preserved untouched")
            }
        }
        val wrapped = SupportSQLiteOpenHelper.Configuration.builder(configuration.context)
            .name(configuration.name)
            .callback(callback)
            .noBackupDirectory(configuration.useNoBackupDirectory)
            .allowDataLossOnRecovery(false)
            .build()
        return delegate.create(wrapped)
    }
}
