package com.penningtonlabs.baileyscart.core.storage

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/*
 * BC-UI-S2b-Spike ONLY. One encrypted database per synthetic account (the account dimension is the
 * file itself); every row carries familyId and every DAO statement filters by it.
 */

@Entity(tableName = "family_scope")
data class FamilyScopeRow(
    @PrimaryKey val familyId: String,
    val epoch: Long,
    val access: String,
    val rev: Long,
)

@Entity(tableName = "snapshot_header")
data class SnapshotHeaderRow(
    @PrimaryKey val familyId: String,
    val epoch: Long,
    /** Added in schema v2 (migration test). Display-only; never used for ordering. */
    val receivedAtWall: Long?,
)

@Entity(tableName = "snapshot_item", primaryKeys = ["familyId", "itemId"])
data class SnapshotItemRow(
    val familyId: String,
    val itemId: String,
    val name: String,
    val category: String,
    val version: Long,
    val nameKeyId: String?,
    val canonVersion: Int?,
)

@Entity(
    tableName = "outbox",
    primaryKeys = ["familyId", "sequence"],
    // F-5 repair (schema v3): opId is unique PER FAMILY (S2a scope), never account-wide.
    indices = [Index(value = ["familyId", "opId"], unique = true)],
)
data class OutboxRow(
    val familyId: String,
    val sequence: Long,
    val opId: String,
    val epoch: Long,
    val kind: String,
    val itemId: String,
    val name: String?,
    val category: String?,
    val deleteOpId: String?,
    val state: String,
    val dispatched: Boolean,
    val attempts: Int,
    val dependsOn: String?,
    val committedVersion: Long?,
    val addOutcome: String?,
    val rejection: String?,
    val preItemId: String?,
    val preName: String?,
    val preCategory: String?,
)

@Dao
interface SpikeDao {
    @Query("SELECT * FROM family_scope WHERE familyId = :familyId")
    fun scope(familyId: String): FamilyScopeRow?

    @Query("SELECT familyId FROM family_scope ORDER BY familyId")
    fun scopeIds(): List<String>

    /** Fail-closed insert: a conflict aborts (and rolls back) the enclosing transaction. */
    @Insert(onConflict = OnConflictStrategy.ABORT)
    fun insertScope(row: FamilyScopeRow)

    /** Explicit family-scoped compare-and-update of the scope row; returns affected rows (must be 1). */
    @Query("UPDATE family_scope SET epoch = :epoch, access = :access, rev = :newRev WHERE familyId = :familyId AND rev = :expectedRev")
    fun updateScope(familyId: String, epoch: Long, access: String, newRev: Long, expectedRev: Long): Int

    @Query("SELECT * FROM outbox WHERE familyId = :familyId ORDER BY sequence")
    fun outbox(familyId: String): List<OutboxRow>

    /** F-5 repair: new operations are inserted fail-closed (ABORT); never REPLACE, IGNORE or upsert. */
    @Insert(onConflict = OnConflictStrategy.ABORT)
    fun insertOps(rows: List<OutboxRow>)

    /**
     * F-5 repair: explicit, family-scoped state transition of ONE existing operation, guarded by its expected
     * prior state and attempt count. Immutable identity/payload columns are never written. Returns affected rows.
     */
    @Query(
        "UPDATE outbox SET state = :state, dispatched = :dispatched, attempts = :attempts, " +
            "committedVersion = :committedVersion, addOutcome = :addOutcome, rejection = :rejection " +
            "WHERE familyId = :familyId AND opId = :opId AND sequence = :sequence " +
            "AND state = :expectedState AND attempts = :expectedAttempts",
    )
    fun updateOpState(
        familyId: String,
        opId: String,
        sequence: Long,
        expectedState: String,
        expectedAttempts: Int,
        state: String,
        dispatched: Boolean,
        attempts: Int,
        committedVersion: Long?,
        addOutcome: String?,
        rejection: String?,
    ): Int

    @Query("SELECT * FROM snapshot_header WHERE familyId = :familyId")
    fun snapshotHeader(familyId: String): SnapshotHeaderRow?

    @Query("SELECT * FROM snapshot_item WHERE familyId = :familyId ORDER BY itemId")
    fun snapshotItems(familyId: String): List<SnapshotItemRow>

    @Insert(onConflict = OnConflictStrategy.ABORT)
    fun insertSnapshotHeader(row: SnapshotHeaderRow)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    fun insertSnapshotItems(rows: List<SnapshotItemRow>)

    @Query("DELETE FROM snapshot_item WHERE familyId = :familyId")
    fun deleteSnapshotItems(familyId: String): Int

    @Query("DELETE FROM snapshot_header WHERE familyId = :familyId")
    fun deleteSnapshotHeader(familyId: String): Int

    @Query("DELETE FROM outbox WHERE familyId = :familyId")
    fun deleteOutbox(familyId: String): Int

    @Query("DELETE FROM family_scope WHERE familyId = :familyId")
    fun deleteScope(familyId: String): Int

    /** Sign-out experimental policy: drop every cached snapshot (all families of this account file). */
    @Query("DELETE FROM snapshot_item")
    fun deleteAllSnapshotItems(): Int

    @Query("DELETE FROM snapshot_header")
    fun deleteAllSnapshotHeaders(): Int
}

@Database(
    entities = [FamilyScopeRow::class, SnapshotHeaderRow::class, SnapshotItemRow::class, OutboxRow::class],
    version = SpikeDatabase.VERSION,
    exportSchema = true,
)
abstract class SpikeDatabase : RoomDatabase() {
    abstract fun dao(): SpikeDao

    companion object {
        const val VERSION = 3

        /** v1 → v2: add a nullable display-only column. Never drops or rewrites outbox rows. */
        val MIGRATION_1_2: Migration = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `snapshot_header` ADD COLUMN `receivedAtWall` INTEGER")
            }
        }

        /**
         * v2 → v3 (F-5 repair): replace the account-wide unique opId index with a per-family unique
         * (familyId, opId) index. Index-only change: no row is read, rewritten, moved or deleted. Any existing
         * v2 data already satisfies the stricter old constraint, so the new index cannot fail on it.
         */
        val MIGRATION_2_3: Migration = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("DROP INDEX IF EXISTS `index_outbox_opId`")
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_outbox_familyId_opId` ON `outbox` (`familyId`, `opId`)")
            }
        }
    }
}
