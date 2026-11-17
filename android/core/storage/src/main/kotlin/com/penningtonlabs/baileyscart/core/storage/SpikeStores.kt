package com.penningtonlabs.baileyscart.core.storage

import com.penningtonlabs.baileyscart.core.model.offline.AccountKey
import com.penningtonlabs.baileyscart.core.model.offline.AddOutcome
import com.penningtonlabs.baileyscart.core.model.offline.Category
import com.penningtonlabs.baileyscart.core.model.offline.FamilyEpoch
import com.penningtonlabs.baileyscart.core.model.offline.FamilyId
import com.penningtonlabs.baileyscart.core.model.offline.FamilyKey
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutbox
import com.penningtonlabs.baileyscart.core.model.offline.FamilyOutboxRestore
import com.penningtonlabs.baileyscart.core.model.offline.ItemCommand
import com.penningtonlabs.baileyscart.core.model.offline.ItemId
import com.penningtonlabs.baileyscart.core.model.offline.ItemImage
import com.penningtonlabs.baileyscart.core.model.offline.ItemName
import com.penningtonlabs.baileyscart.core.model.offline.LocalListStore
import com.penningtonlabs.baileyscart.core.model.offline.NameValidation
import com.penningtonlabs.baileyscart.core.model.offline.OpId
import com.penningtonlabs.baileyscart.core.model.offline.OpState
import com.penningtonlabs.baileyscart.core.model.offline.OutboxOperation
import com.penningtonlabs.baileyscart.core.model.offline.OutboxStore
import com.penningtonlabs.baileyscart.core.model.offline.ScopeAccess
import com.penningtonlabs.baileyscart.core.model.offline.ServerErrorCode
import com.penningtonlabs.baileyscart.core.model.offline.ServerItem
import com.penningtonlabs.baileyscart.core.model.offline.ServerSnapshot

/** Stored state could not be decoded or violates S2a invariants. Fail closed: never treated as "absent". */
class StoreCorruptException(message: String) : IllegalStateException(message)

/** A family-scoped write affected an unexpected number of rows or changed an immutable column. Rolls back the CAS. */
class CasConflictException(message: String) : IllegalStateException(message)

/** A request for another account's scope reached this account's store. */
class ScopeViolationException : IllegalArgumentException("scope does not belong to this account store")

/** Test-only crash/fault injection points inside a write transaction (no-op in normal use). */
fun interface TxnHook {
    fun beforeCommit(label: String)
}

/**
 * S2a [OutboxStore] and [LocalListStore] adapters over one account's encrypted database.
 *
 * compareAndSet = exactly one write transaction (Room runInTransaction → BEGIN IMMEDIATE): enforce
 * synchronous=FULL on the writing connection, compare the stored rows with [expected], then write
 * [updated]. A rejection plus its transitive BLOCKED_DEPENDENCY states therefore commit atomically,
 * because S2a already carries both in one FamilyOutbox value (Q-7).
 *
 * read() is a recovery read: S2a's private constructor can only be reached through
 * FamilyOutbox.restore(), which maps a stored IN_FLIGHT operation to RETRY_WAIT. CAS comparisons are
 * therefore made on the stored row representation, never on a reconstructed value.
 */
class SpikeStores internal constructor(
    private val account: AccountKey,
    private val write: (label: String, block: () -> Unit) -> Unit,
    private val dao: SpikeDao,
    @Volatile var txnHook: TxnHook = TxnHook { },
) {
    /** S2a OutboxStore port. */
    val outbox: OutboxStore = object : OutboxStore {
        override fun read(key: FamilyKey): FamilyOutbox? = readOutbox(key)
        override fun compareAndSet(key: FamilyKey, expected: FamilyOutbox?, updated: FamilyOutbox): Boolean =
            casOutbox(key, expected, updated)
    }

    /** S2a LocalListStore port. */
    val list: LocalListStore = object : LocalListStore {
        override fun read(key: FamilyKey): ServerSnapshot? = readSnapshot(key)
        override fun replace(snapshot: ServerSnapshot) = replaceSnapshot(snapshot)
    }

    private fun checkScope(key: FamilyKey) {
        if (key.account != account) throw ScopeViolationException()
    }

    // ---- OutboxStore -------------------------------------------------------------------

    private fun readOutbox(key: FamilyKey): FamilyOutbox? {
        checkScope(key)
        val scope = dao.scope(key.family.value) ?: return null
        return decode(key, scope, dao.outbox(key.family.value))
    }

    private fun casOutbox(key: FamilyKey, expected: FamilyOutbox?, updated: FamilyOutbox): Boolean {
        checkScope(key)
        require(updated.key == key && (expected == null || expected.key == key)) { "outbox key mismatch" }
        var applied = false
        write("cas") {
            val storedScope = dao.scope(key.family.value)
            val storedRows = dao.outbox(key.family.value)
            val matches = if (expected == null) {
                storedScope == null && storedRows.isEmpty()
            } else {
                storedScope != null && storedScope.epoch == expected.currentEpoch.value &&
                    storedScope.access == expected.access.name && storedRows == encode(expected)
            }
            if (!matches) return@write
            txnHook.beforeCommit("cas-pre-write")
            applyFamilyRows(key.family.value, storedScope, storedRows, updated.currentEpoch.value, updated.access.name, encode(updated))
            txnHook.beforeCommit("cas")
            applied = true
        }
        return applied
    }

    /**
     * Startup recovery read: decode with S2a restore semantics and persist the restored, reconciled
     * state in the same transaction so disk matches what will be dispatched.
     */
    fun recover(key: FamilyKey): FamilyOutbox? {
        checkScope(key)
        var result: FamilyOutbox? = null
        write("recover") {
            val scope = dao.scope(key.family.value) ?: return@write
            val storedRows = dao.outbox(key.family.value)
            val restored = decode(key, scope, storedRows)
            applyFamilyRows(key.family.value, scope, storedRows, scope.epoch, scope.access, encode(restored))
            txnHook.beforeCommit("recover")
            result = restored
        }
        return result
    }

    // ---- LocalListStore ----------------------------------------------------------------

    fun readSnapshot(key: FamilyKey): ServerSnapshot? {
        checkScope(key)
        val header = dao.snapshotHeader(key.family.value) ?: return null
        val epoch = FamilyEpoch.of(header.epoch) ?: throw StoreCorruptException("bad snapshot epoch")
        val items = dao.snapshotItems(key.family.value).map {
            ServerItem(
                itemId = ItemId.parse(it.itemId) ?: throw StoreCorruptException("bad item id"),
                name = it.name,
                category = category(it.category),
                version = it.version,
                nameKeyId = it.nameKeyId,
                canonVersion = it.canonVersion,
            )
        }
        return ServerSnapshot(key, epoch, items)
    }

    private fun replaceSnapshot(snapshot: ServerSnapshot) {
        checkScope(snapshot.key)
        val family = snapshot.key.family.value
        write("snapshot") {
            dao.deleteSnapshotItems(family)
            dao.deleteSnapshotHeader(family)
            dao.insertSnapshotHeader(SnapshotHeaderRow(family, snapshot.epoch.value, null))
            dao.insertSnapshotItems(
                snapshot.items.map { SnapshotItemRow(family, it.itemId.value, it.name, it.category.name, it.version, it.nameKeyId, it.canonVersion) },
            )
            txnHook.beforeCommit("snapshot")
        }
    }

    // ---- Spike-only maintenance prototypes (additive; PL approval pending) -------------

    /** Authoritative-revocation purge of one family scope, in one transaction. */
    fun purgeFamily(key: FamilyKey) {
        checkScope(key)
        val family = key.family.value
        write("purge") {
            dao.deleteOutbox(family)
            dao.deleteSnapshotItems(family)
            dao.deleteSnapshotHeader(family)
            dao.deleteScope(family)
            txnHook.beforeCommit("purge")
        }
    }

    /** Experimental sign-out policy: drop cached snapshots; keep encrypted outbox + scope/epoch. */
    fun dropAllSnapshots() {
        write("signout-drop-snapshots") {
            dao.deleteAllSnapshotItems()
            dao.deleteAllSnapshotHeaders()
            txnHook.beforeCommit("signout-drop-snapshots")
        }
    }

    fun scopes(): List<FamilyKey> = dao.scopeIds().map { FamilyKey(account, FamilyId.of(it) ?: throw StoreCorruptException("bad family id")) }

    /**
     * F-5 repair: apply [newRows] for ONE family inside the caller's transaction, fail closed.
     *  - every stored operation must still be present (never removed);
     *  - an existing operation may change only its mutable state columns, via an explicit
     *    UPDATE ... WHERE familyId AND opId AND sequence AND expected state/attempts that must affect exactly 1 row;
     *  - any change to an immutable column (identity, payload, sequence, epoch, dependency) is a conflict;
     *  - new operations are inserted with ABORT; a uniqueness conflict throws.
     * Any exception aborts the enclosing transaction, so the whole CAS rolls back.
     */
    private fun applyFamilyRows(
        familyId: String,
        storedScope: FamilyScopeRow?,
        storedRows: List<OutboxRow>,
        epoch: Long,
        access: String,
        newRows: List<OutboxRow>,
    ) {
        if (newRows.any { it.familyId != familyId }) throw CasConflictException("row for another family in CAS")
        val stored = storedRows.associateBy { it.opId }
        val incoming = newRows.associateBy { it.opId }
        if (incoming.size != newRows.size) throw CasConflictException("duplicate opId within one family")
        if (stored.keys.any { it !in incoming }) throw CasConflictException("update would remove a stored operation")
        if (storedScope == null) {
            dao.insertScope(FamilyScopeRow(familyId, epoch, access, 1))
        } else {
            val n = dao.updateScope(familyId, epoch, access, storedScope.rev + 1, storedScope.rev)
            if (n != 1) throw CasConflictException("scope update affected $n rows")
        }
        val inserts = ArrayList<OutboxRow>()
        for (row in newRows) {
            val old = stored[row.opId]
            if (old == null) {
                inserts += row
                continue
            }
            val sameIdentity = old.copy(
                state = row.state, dispatched = row.dispatched, attempts = row.attempts,
                committedVersion = row.committedVersion, addOutcome = row.addOutcome, rejection = row.rejection,
            ) == row
            if (!sameIdentity) throw CasConflictException("immutable identity/payload changed for an existing operation")
            if (old == row) continue
            val n = dao.updateOpState(
                familyId = familyId, opId = row.opId, sequence = row.sequence,
                expectedState = old.state, expectedAttempts = old.attempts,
                state = row.state, dispatched = row.dispatched, attempts = row.attempts,
                committedVersion = row.committedVersion, addOutcome = row.addOutcome, rejection = row.rejection,
            )
            if (n != 1) throw CasConflictException("state update affected $n rows")
        }
        if (inserts.isNotEmpty()) dao.insertOps(inserts)
    }

    // ---- codec -------------------------------------------------------------------------

    private fun decode(key: FamilyKey, scope: FamilyScopeRow, rows: List<OutboxRow>): FamilyOutbox {
        val epoch = FamilyEpoch.of(scope.epoch) ?: throw StoreCorruptException("bad scope epoch")
        val access = enumValueOrNull<ScopeAccess>(scope.access) ?: throw StoreCorruptException("bad access")
        val ops = rows.map { decodeOp(key, it) }
        return when (val r = FamilyOutbox.restore(key, epoch, access, ops)) {
            is FamilyOutboxRestore.Restored -> r.outbox
            FamilyOutboxRestore.Corrupt -> throw StoreCorruptException("stored outbox violates S2a invariants")
        }
    }

    private fun decodeOp(key: FamilyKey, r: OutboxRow): OutboxOperation {
        val itemId = ItemId.parse(r.itemId) ?: throw StoreCorruptException("bad item id")
        val command = when (r.kind) {
            KIND_ADD -> ItemCommand.Add(itemId, name(r.name ?: throw StoreCorruptException("add without name")), category(r.category))
            KIND_EDIT -> ItemCommand.Edit(itemId, r.name?.let(::name), r.category?.let(::category))
            KIND_DELETE -> ItemCommand.Delete(itemId)
            KIND_UNDO -> ItemCommand.UndoDelete(itemId, opId(r.deleteOpId))
            else -> throw StoreCorruptException("unknown command kind")
        }
        val pre = if (r.preItemId != null) {
            ItemImage(ItemId.parse(r.preItemId) ?: throw StoreCorruptException("bad pre item"), r.preName ?: "", category(r.preCategory))
        } else {
            null
        }
        return OutboxOperation(
            opId = opId(r.opId),
            key = key,
            epoch = FamilyEpoch.of(r.epoch) ?: throw StoreCorruptException("bad op epoch"),
            sequence = r.sequence,
            command = command,
            state = enumValueOrNull<OpState>(r.state) ?: throw StoreCorruptException("bad state"),
            dispatched = r.dispatched,
            attempts = r.attempts,
            dependsOn = r.dependsOn?.let(::opId),
            committedVersion = r.committedVersion,
            addOutcome = r.addOutcome?.let { enumValueOrNull<AddOutcome>(it) ?: throw StoreCorruptException("bad outcome") },
            rejection = r.rejection?.let(::ServerErrorCode),
            preImage = pre,
        )
    }

    private fun encode(outbox: FamilyOutbox): List<OutboxRow> = outbox.operations.map { op ->
        val c = op.command
        OutboxRow(
            familyId = outbox.key.family.value,
            sequence = op.sequence,
            opId = op.opId.value,
            epoch = op.epoch.value,
            kind = when (c) {
                is ItemCommand.Add -> KIND_ADD
                is ItemCommand.Edit -> KIND_EDIT
                is ItemCommand.Delete -> KIND_DELETE
                is ItemCommand.UndoDelete -> KIND_UNDO
            },
            itemId = c.itemId.value,
            name = when (c) {
                is ItemCommand.Add -> c.name.display
                is ItemCommand.Edit -> c.name?.display
                else -> null
            },
            category = when (c) {
                is ItemCommand.Add -> c.category.name
                is ItemCommand.Edit -> c.category?.name
                else -> null
            },
            deleteOpId = (c as? ItemCommand.UndoDelete)?.deleteOpId?.value,
            state = op.state.name,
            dispatched = op.dispatched,
            attempts = op.attempts,
            dependsOn = op.dependsOn?.value,
            committedVersion = op.committedVersion,
            addOutcome = op.addOutcome?.name,
            rejection = op.rejection?.code,
            preItemId = op.preImage?.itemId?.value,
            preName = op.preImage?.name,
            preCategory = op.preImage?.category?.name,
        )
    }

    private fun name(raw: String): ItemName = when (val v = ItemName.validate(raw)) {
        is NameValidation.Valid -> v.name
        is NameValidation.Invalid -> throw StoreCorruptException("stored name fails validation")
    }

    private fun category(raw: String?): Category =
        raw?.let { enumValueOrNull<Category>(it) } ?: throw StoreCorruptException("bad category")

    private fun opId(raw: String?): OpId = raw?.let(OpId::parse) ?: throw StoreCorruptException("bad op id")

    private inline fun <reified E : Enum<E>> enumValueOrNull(raw: String): E? = enumValues<E>().firstOrNull { it.name == raw }

    private companion object {
        const val KIND_ADD = "ADD"
        const val KIND_EDIT = "EDIT"
        const val KIND_DELETE = "DELETE"
        const val KIND_UNDO = "UNDO"
    }
}
