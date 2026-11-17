package com.penningtonlabs.baileyscart.core.storage

import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.ItemCommand
import net.zetetic.database.sqlcipher.SQLiteDatabase
import java.io.File

/**
 * Hand-built schema v1 = Room-exported v2 schema (schemas/.../2.json) without snapshot_header.receivedAtWall.
 * Written with the same SQLCipher raw key, user_version=1, no room_master_table (pre-Room-2 legacy shape).
 */
object MigrationFixture {
    private val V1_DDL = listOf(
        "CREATE TABLE IF NOT EXISTS `family_scope` (`familyId` TEXT NOT NULL, `epoch` INTEGER NOT NULL, `access` TEXT NOT NULL, `rev` INTEGER NOT NULL, PRIMARY KEY(`familyId`))",
        "CREATE TABLE IF NOT EXISTS `snapshot_header` (`familyId` TEXT NOT NULL, `epoch` INTEGER NOT NULL, PRIMARY KEY(`familyId`))",
        "CREATE TABLE IF NOT EXISTS `snapshot_item` (`familyId` TEXT NOT NULL, `itemId` TEXT NOT NULL, `name` TEXT NOT NULL, `category` TEXT NOT NULL, `version` INTEGER NOT NULL, `nameKeyId` TEXT, `canonVersion` INTEGER, PRIMARY KEY(`familyId`, `itemId`))",
        "CREATE TABLE IF NOT EXISTS `outbox` (`familyId` TEXT NOT NULL, `sequence` INTEGER NOT NULL, `opId` TEXT NOT NULL, `epoch` INTEGER NOT NULL, `kind` TEXT NOT NULL, `itemId` TEXT NOT NULL, `name` TEXT, `category` TEXT, `deleteOpId` TEXT, `state` TEXT NOT NULL, `dispatched` INTEGER NOT NULL, `attempts` INTEGER NOT NULL, `dependsOn` TEXT, `committedVersion` INTEGER, `addOutcome` TEXT, `rejection` TEXT, `preItemId` TEXT, `preName` TEXT, `preCategory` TEXT, PRIMARY KEY(`familyId`, `sequence`))",
        "CREATE UNIQUE INDEX IF NOT EXISTS `index_outbox_opId` ON `outbox` (`opId`)",
    )

    /** Exact v2 DDL from the historical exported schema `schemas/…/2.json` (sha256 e1a7aba4…), incl. its
     *  ACCOUNT-WIDE unique opId index and room_master_table identity — the shape of a pre-F-5 v2 store. */
    private val V2_DDL = listOf(
        "CREATE TABLE IF NOT EXISTS `family_scope` (`familyId` TEXT NOT NULL, `epoch` INTEGER NOT NULL, `access` TEXT NOT NULL, `rev` INTEGER NOT NULL, PRIMARY KEY(`familyId`))",
        "CREATE TABLE IF NOT EXISTS `snapshot_header` (`familyId` TEXT NOT NULL, `epoch` INTEGER NOT NULL, `receivedAtWall` INTEGER, PRIMARY KEY(`familyId`))",
        "CREATE TABLE IF NOT EXISTS `snapshot_item` (`familyId` TEXT NOT NULL, `itemId` TEXT NOT NULL, `name` TEXT NOT NULL, `category` TEXT NOT NULL, `version` INTEGER NOT NULL, `nameKeyId` TEXT, `canonVersion` INTEGER, PRIMARY KEY(`familyId`, `itemId`))",
        "CREATE TABLE IF NOT EXISTS `outbox` (`familyId` TEXT NOT NULL, `sequence` INTEGER NOT NULL, `opId` TEXT NOT NULL, `epoch` INTEGER NOT NULL, `kind` TEXT NOT NULL, `itemId` TEXT NOT NULL, `name` TEXT, `category` TEXT, `deleteOpId` TEXT, `state` TEXT NOT NULL, `dispatched` INTEGER NOT NULL, `attempts` INTEGER NOT NULL, `dependsOn` TEXT, `committedVersion` INTEGER, `addOutcome` TEXT, `rejection` TEXT, `preItemId` TEXT, `preName` TEXT, `preCategory` TEXT, PRIMARY KEY(`familyId`, `sequence`))",
        "CREATE UNIQUE INDEX IF NOT EXISTS `index_outbox_opId` ON `outbox` (`opId`)",
        "CREATE TABLE IF NOT EXISTS room_master_table (id INTEGER PRIMARY KEY,identity_hash TEXT)",
        "INSERT OR REPLACE INTO room_master_table (id,identity_hash) VALUES(42, 'ef02cea35459ef1d94811840a88d28e5')",
    )

    /** v2 file with several NON-EMPTY families (opIds distinct, as the v2 global index required). */
    fun writeV2(dbFile: File, key: ByteArray, outboxes: List<FamilyOutbox>, omitSnapshotHeader: Boolean = false) {
        SpikeAccountStore.ensureNativeLoaded()
        val db = SQLiteDatabase.openOrCreateDatabase(dbFile, key, null, SpikeAccountStore.ThrowingErrorHandler, null)
        try {
            db.beginTransaction()
            V2_DDL.filter { !(omitSnapshotHeader && "snapshot_header" in it) }.forEach(db::execSQL)
            for ((i, outbox) in outboxes.withIndex()) {
                val fam = outbox.key.family.value
                db.execSQL("INSERT INTO family_scope VALUES (?,?,?,?)", arrayOf<Any>(fam, outbox.currentEpoch.value, outbox.access.name, 1L))
                if (!omitSnapshotHeader) db.execSQL("INSERT INTO snapshot_header VALUES (?,?,?)", arrayOf<Any?>(fam, outbox.currentEpoch.value, null))
                db.execSQL("INSERT INTO snapshot_item VALUES (?,?,?,?,?,?,?)", arrayOf<Any?>(fam, Fx.uuid(0x100090L + i), "Mig snapshot $i", "MISC", 1L, null, null))
                insertOps(db, outbox)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        db.execSQL("PRAGMA user_version=2")
        db.rawQuery("PRAGMA journal_mode=WAL", null).use { it.moveToFirst() }
        db.close()
    }

    private fun insertOps(db: SQLiteDatabase, outbox: FamilyOutbox) {
        val fam = outbox.key.family.value
        for (op in outbox.operations) {
            val c = op.command
            db.execSQL(
                "INSERT INTO outbox VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                arrayOf<Any?>(
                    fam, op.sequence, op.opId.value, op.epoch.value,
                    when (c) { is ItemCommand.Add -> "ADD"; is ItemCommand.Edit -> "EDIT"; is ItemCommand.Delete -> "DELETE"; is ItemCommand.UndoDelete -> "UNDO" },
                    c.itemId.value,
                    (c as? ItemCommand.Add)?.name?.display ?: (c as? ItemCommand.Edit)?.name?.display,
                    (c as? ItemCommand.Add)?.category?.name ?: (c as? ItemCommand.Edit)?.category?.name,
                    (c as? ItemCommand.UndoDelete)?.deleteOpId?.value,
                    op.state.name, if (op.dispatched) 1 else 0, op.attempts, op.dependsOn?.value,
                    op.committedVersion, op.addOutcome?.name, op.rejection?.code,
                    op.preImage?.itemId?.value, op.preImage?.name, op.preImage?.category?.name,
                ),
            )
        }
    }

    /** Every outbox row (all columns, all families) through a fresh read-only SQLCipher connection. */
    fun rawOutbox(dbFile: File, key: ByteArray, familyId: String? = null): List<List<String?>> {
        SpikeAccountStore.ensureNativeLoaded()
        val db = SQLiteDatabase.openDatabase(dbFile.absolutePath, key, null, SQLiteDatabase.OPEN_READONLY, SpikeAccountStore.ThrowingErrorHandler, null)
        try {
            val sql = "SELECT * FROM outbox" + (if (familyId != null) " WHERE familyId = ?" else "") + " ORDER BY familyId, sequence"
            return db.rawQuery(sql, familyId?.let { arrayOf(it) }).use { c ->
                buildList { while (c.moveToNext()) add((0 until c.columnCount).map { if (c.isNull(it)) null else c.getString(it) }) }
            }
        } finally {
            db.close()
        }
    }

    fun writeV1(dbFile: File, key: ByteArray, outbox: FamilyOutbox?, omitSnapshotHeader: Boolean = false) {
        SpikeAccountStore.ensureNativeLoaded()
        val db = SQLiteDatabase.openOrCreateDatabase(dbFile, key, null, SpikeAccountStore.ThrowingErrorHandler, null)
        try {
            db.beginTransaction()
            V1_DDL.filter { !(omitSnapshotHeader && "snapshot_header" in it) }.forEach(db::execSQL)
            if (outbox != null) {
                val fam = outbox.key.family.value
                db.execSQL("INSERT INTO family_scope VALUES (?,?,?,?)", arrayOf<Any>(fam, outbox.currentEpoch.value, outbox.access.name, 1L))
                db.execSQL("INSERT INTO snapshot_header VALUES (?,?)", arrayOf<Any>(fam, outbox.currentEpoch.value))
                db.execSQL("INSERT INTO snapshot_item VALUES (?,?,?,?,?,?,?)", arrayOf<Any?>(fam, Fx.uuid(0x100099), "Mig snapshot", "MISC", 1L, null, null))
                for (op in outbox.operations) {
                    val c = op.command
                    db.execSQL(
                        "INSERT INTO outbox VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        arrayOf<Any?>(
                            fam, op.sequence, op.opId.value, op.epoch.value,
                            when (c) { is ItemCommand.Add -> "ADD"; is ItemCommand.Edit -> "EDIT"; is ItemCommand.Delete -> "DELETE"; is ItemCommand.UndoDelete -> "UNDO" },
                            c.itemId.value,
                            (c as? ItemCommand.Add)?.name?.display ?: (c as? ItemCommand.Edit)?.name?.display,
                            (c as? ItemCommand.Add)?.category?.name ?: (c as? ItemCommand.Edit)?.category?.name,
                            (c as? ItemCommand.UndoDelete)?.deleteOpId?.value,
                            op.state.name, if (op.dispatched) 1 else 0, op.attempts, op.dependsOn?.value,
                            op.committedVersion, op.addOutcome?.name, op.rejection?.code,
                            op.preImage?.itemId?.value, op.preImage?.name, op.preImage?.category?.name,
                        ),
                    )
                }
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        db.execSQL("PRAGMA user_version=1")
        db.rawQuery("PRAGMA journal_mode=WAL", null).use { it.moveToFirst() } // the shape a v1 Room/WAL store would have
        db.close()
    }
}
