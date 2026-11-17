package com.penningtonlabs.baileyscart.core.storage

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * Test-only explicit acknowledgement. Both flags must be recorded separately (opt-in, then a
 * separate confirmation). Design draft only; no production wording or retention policy is implied.
 */
data class RecoveryAcknowledgement(val optedIn: Boolean, val confirmed: Boolean)

sealed interface SetAsideResult {
    data class Done(val quarantineDir: File) : SetAsideResult
    data object NotAcknowledged : SetAsideResult
    data object NothingToSetAside : SetAsideResult
}

/**
 * Non-destructive recovery: after an explicit acknowledgement, MOVE (never delete) an account's files
 * into quarantine/<tag>-<n>/. The Keystore alias is not deleted (its name stays inside the moved .dek).
 * An intent marker is written (fsync + atomic rename) before the first move so an interrupted set-aside
 * resumes idempotently. Nothing is ever deleted, salvaged or replayed.
 */
class RecoveryController(private val keys: KeyManager) {
    /** Test-only crash injection between moves (no-op normally). */
    @Volatile var afterMove: (fileName: String) -> Unit = { }

    private fun marker(tag: AccountTag) = File(keys.root, "${tag.hex}.recovery")

    fun pending(tag: AccountTag): Boolean = marker(tag).exists()

    private fun candidates(tag: AccountTag): List<File> {
        val db = keys.dbFile(tag)
        return listOf(File(db.path + "-wal"), File(db.path + "-shm"), File(db.path + "-journal"), db, keys.dekFile(tag), keys.createdMarker(tag))
    }

    fun setAside(tag: AccountTag, ack: RecoveryAcknowledgement): SetAsideResult {
        if (!ack.optedIn || !ack.confirmed) return SetAsideResult.NotAcknowledged
        if (pending(tag)) return resume(tag)
        val present = candidates(tag).filter { it.exists() }
        if (present.isEmpty()) return SetAsideResult.NothingToSetAside
        val quarantineRoot = File(keys.root, "quarantine").apply { mkdirs() }
        var n = 1
        while (File(quarantineRoot, "${tag.hex}-$n").exists()) n++
        val content = buildString {
            append("v1\n")
            append("ack=optedIn,confirmed\n")
            append("dir=${tag.hex}-$n\n")
            present.forEach { append("file=${it.name}\n") }
        }
        KeyManager.writeAtomically(marker(tag), content.toByteArray(Charsets.US_ASCII))
        return resume(tag)
    }

    /** Complete a previously acknowledged set-aside. Idempotent; moves only, never deletes account files. */
    fun resume(tag: AccountTag): SetAsideResult {
        val m = marker(tag)
        if (!m.exists()) return SetAsideResult.NothingToSetAside
        val lines = m.readText(Charsets.US_ASCII).lines()
        check(lines.firstOrNull() == "v1" && "ack=optedIn,confirmed" in lines) { "unrecognized recovery marker" }
        val dirName = lines.first { it.startsWith("dir=") }.removePrefix("dir=")
        val dest = File(File(keys.root, "quarantine"), dirName).apply { mkdirs() }
        for (name in lines.filter { it.startsWith("file=") }.map { it.removePrefix("file=") }) {
            val src = File(keys.root, name)
            val dst = File(dest, name)
            if (src.exists() && !dst.exists()) {
                Files.move(src.toPath(), dst.toPath(), StandardCopyOption.ATOMIC_MOVE)
                afterMove(name)
            } else {
                check(!src.exists()) { "both source and destination exist for $name; refusing to overwrite" }
            }
        }
        KeyManager.writeAtomically(File(dest, "SET_ASIDE_COMPLETE"), "acknowledged; nothing deleted\n".toByteArray(Charsets.US_ASCII))
        Files.move(m.toPath(), File(dest, "recovery-marker.txt").toPath(), StandardCopyOption.ATOMIC_MOVE)
        return SetAsideResult.Done(dest)
    }
}
