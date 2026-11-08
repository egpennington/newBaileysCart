package com.penningtonlabs.baileyscart.core.model.offline

import org.junit.Assert.assertEquals

/** Fictional test identities only. These are not real accounts, UIDs or families. */
object Fx {
    val ACCOUNT_A: AccountKey = AccountKey.of("test-account-a")!!
    val ACCOUNT_B: AccountKey = AccountKey.of("test-account-b")!!
    val FAMILY_1: FamilyId = FamilyId.of("test-family-1")!!
    val FAMILY_2: FamilyId = FamilyId.of("test-family-2")!!
    val A1 = FamilyKey(ACCOUNT_A, FAMILY_1)
    val A2 = FamilyKey(ACCOUNT_A, FAMILY_2)
    val B1 = FamilyKey(ACCOUNT_B, FAMILY_1) // same family id, different account
    val E1: FamilyEpoch = FamilyEpoch.INITIAL
    val E2: FamilyEpoch = FamilyEpoch.of(2)!!

    private var counter = 0

    /** Deterministic, valid UUID v4 strings. */
    fun uuid(n: Int): String = "00000000-0000-4000-8000-%012x".format(n)
    fun item(n: Int): ItemId = ItemId.parse(uuid(n))!!
    fun op(n: Int): OpId = OpId.parse(uuid(10_000 + n))!!
    fun freshOp(): OpId = op(++counter)

    fun name(s: String): ItemName = (ItemName.validate(s) as NameValidation.Valid).name

    fun add(id: ItemId, n: String, c: Category = Category.PRODUCE) = ItemCommand.Add(id, name(n), c)
    fun edit(id: ItemId, n: String? = null, c: Category? = null) = ItemCommand.Edit(id, n?.let { name(it) }, c)
    fun delete(id: ItemId) = ItemCommand.Delete(id)
    fun undo(id: ItemId, deleteOp: OpId) = ItemCommand.UndoDelete(id, deleteOp)
}

fun Transition.applied(): FamilyOutbox = when (this) {
    is Transition.Applied -> outbox
    is Transition.Unchanged -> throw AssertionError("expected Applied but was Unchanged")
    is Transition.Refused -> throw AssertionError("expected Applied but was Refused($reason)")
}

fun Transition.refusal(): Refusal = when (this) {
    is Transition.Refused -> reason
    else -> throw AssertionError("expected Refused but was $this")
}

fun Dispatch.sent(): Pair<FamilyOutbox, OutboxOperation> = when (this) {
    is Dispatch.Send -> outbox to operation
    is Dispatch.Idle -> throw AssertionError("expected Send but was Idle($reason)")
}

fun Dispatch.idle(expected: IdleReason): FamilyOutbox = when (this) {
    is Dispatch.Idle -> {
        assertEquals(expected, reason)
        outbox
    }
    is Dispatch.Send -> throw AssertionError("expected Idle($expected) but sent ${operation.opId}")
}

/** Enqueue under the outbox's own key and current epoch. */
fun FamilyOutbox.q(opId: OpId, cmd: ItemCommand, pre: ItemImage? = null): FamilyOutbox =
    enqueue(opId, key, currentEpoch, cmd, pre).applied()

fun FamilyOutbox.state(opId: OpId): OpState = operation(opId)!!.state

/** Dispatch the next operation and commit it with [version]. Returns the outbox and the operation. */
fun FamilyOutbox.sendAndCommit(version: Long = 1): Pair<FamilyOutbox, OutboxOperation> {
    val (o, op) = dispatchNext().sent()
    val outcome = if (op.command is ItemCommand.Add) AddOutcome.CREATED else null
    return o.recordCommitted(key, op.opId, version, outcome).applied() to op
}
