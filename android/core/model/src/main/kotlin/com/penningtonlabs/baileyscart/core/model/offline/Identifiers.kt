package com.penningtonlabs.baileyscart.core.model.offline

import java.util.UUID

/*
 * BC-UI-S2a offline domain core: identifiers and scope.
 * Pure Kotlin. No storage, network, Android or clock dependencies.
 */

private val UUID_V4 = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

/**
 * Client-generated item identity (API v0.4 `items.add`: "UUID v4 client itemId").
 * Accepted only in the canonical lowercase 8-4-4-4-12 form with version 4 and the RFC 4122
 * variant. It is stable across retries and is never derived from the display name.
 */
@JvmInline
value class ItemId private constructor(val value: String) {
    override fun toString(): String = "ItemId($value)"

    companion object {
        fun parse(raw: String): ItemId? = if (UUID_V4.matches(raw)) ItemId(raw) else null
        fun random(): ItemId = ItemId(UUID.randomUUID().toString())
    }
}

/** Identity of one logical command (`opId`). A retry reuses the same OpId and payload. */
@JvmInline
value class OpId private constructor(val value: String) {
    override fun toString(): String = "OpId($value)"

    companion object {
        fun parse(raw: String): OpId? = if (UUID_V4.matches(raw)) OpId(raw) else null
        fun random(): OpId = OpId(UUID.randomUUID().toString())
    }
}

/**
 * Opaque, account-scoped partition key. It is NOT an authorization claim and never holds a raw
 * UID in this sprint; tests use fictional values. toString() is redacted so the value cannot
 * reach logs by accident.
 */
@JvmInline
value class AccountKey private constructor(val value: String) {
    override fun toString(): String = "AccountKey(<redacted>)"

    companion object {
        fun of(raw: String): AccountKey? = if (raw.isNotBlank() && raw.none { it.isWhitespace() }) AccountKey(raw) else null
    }
}

/** Server-issued immutable family identifier, treated as opaque. */
@JvmInline
value class FamilyId private constructor(val value: String) {
    override fun toString(): String = "FamilyId($value)"

    companion object {
        fun of(raw: String): FamilyId? = if (raw.isNotBlank() && raw.none { it.isWhitespace() }) FamilyId(raw) else null
    }
}

/**
 * Server-authoritative family epoch (API v0.4: an integer initialized to 1 and incremented
 * only by a successful restore). It is captured when an operation is created and never re-tagged.
 */
@JvmInline
value class FamilyEpoch private constructor(val value: Long) : Comparable<FamilyEpoch> {
    override fun compareTo(other: FamilyEpoch): Int = value.compareTo(other.value)
    override fun toString(): String = "FamilyEpoch($value)"

    companion object {
        val INITIAL: FamilyEpoch = FamilyEpoch(1)
        fun of(raw: Long): FamilyEpoch? = if (raw >= 1) FamilyEpoch(raw) else null
    }
}

/** Partition key for snapshots and outboxes: one account plus one family. No cross-key mixing. */
data class FamilyKey(val account: AccountKey, val family: FamilyId)

/** The six fixed categories in their approved presentation order. */
enum class Category { PRODUCE, DAIRY, DRY, FROZEN, MISC, MEAT }
