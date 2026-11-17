package com.penningtonlabs.baileyscart.core.storage

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.KeyStore
import java.security.KeyStoreException
import java.security.ProviderException
import java.security.SecureRandom
import java.security.UnrecoverableKeyException
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

/**
 * Synthetic, test-only "verified" session. Only fictional `demo-` identities are accepted; a real UID
 * can never enter the spike. toString() is redacted.
 */
class FakeVerifiedSession(uid: String) {
    internal val uid: String

    init {
        require(uid.startsWith("demo-") && uid.length in 6..64 && uid.all { it.isLetterOrDigit() || it == '-' }) {
            "spike accepts fictional demo- identities only"
        }
        this.uid = uid
    }

    override fun toString(): String = "FakeVerifiedSession(<redacted>)"
}

/** Opaque, non-reversible account tag (128-bit HMAC, hex). Used in file names and aliases only. */
@JvmInline
value class AccountTag(val hex: String) {
    override fun toString(): String = "AccountTag(<redacted>)"
}

/** Unwrapped key material. [sqlcipherKey] is the SQLCipher raw-key form `x'<64 hex>'` as ASCII bytes. */
class KeyMaterial internal constructor(private val dek: ByteArray, val alias: String) {
    val sqlcipherKey: ByteArray = rawKeyBytes(dek)

    /** SHA-256 fingerprint prefix for test evidence only (never the key itself). */
    fun fingerprint(): String =
        java.security.MessageDigest.getInstance("SHA-256").digest(dek).take(6).joinToString("") { "%02x".format(it) }

    fun wipe() {
        dek.fill(0)
        sqlcipherKey.fill(0)
    }

    fun isWiped(): Boolean = dek.all { it == 0.toByte() } && sqlcipherKey.all { it == 0.toByte() }

    override fun toString(): String = "KeyMaterial(<redacted>)"

    private companion object {
        private val HEX = "0123456789abcdef".toByteArray(Charsets.US_ASCII)

        fun rawKeyBytes(dek: ByteArray): ByteArray {
            val out = ByteArray(3 + dek.size * 2)
            out[0] = 'x'.code.toByte()
            out[1] = '\''.code.toByte()
            dek.forEachIndexed { i, b ->
                out[2 + 2 * i] = HEX[(b.toInt() shr 4) and 0xF]
                out[3 + 2 * i] = HEX[b.toInt() and 0xF]
            }
            out[out.size - 1] = '\''.code.toByte()
            return out
        }
    }
}

sealed interface UnwrapResult {
    class Ok(val key: KeyMaterial) : UnwrapResult
    data object KeyMissing : UnwrapResult
    data object UnwrapFailed : UnwrapResult
    data object Transient : UnwrapResult
}

/**
 * DEK lifecycle for one spike root directory. Files:
 *   <tag>.dek      wrapped DEK: "BCD1" | aliasLen | alias | ivLen | iv | ciphertext+tag (AES-256-GCM)
 *   <tag>.db       SQLCipher database (+ -wal, -shm, -journal)
 *   <tag>.created  marker written after the first successful database creation
 * AAD binds the wrapped DEK to the account tag, the database file name and the KEK alias.
 */
class KeyManager(val root: File, private val aliasPrefix: String) {
    private val keyStore: KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    private val tagAlias = "${aliasPrefix}tag_v1"

    init {
        require(aliasPrefix.isNotEmpty() && aliasPrefix.all { it.isLetterOrDigit() || it == '_' })
        root.mkdirs()
    }

    fun dbFile(tag: AccountTag) = File(root, "${tag.hex}.db")
    fun dekFile(tag: AccountTag) = File(root, "${tag.hex}.dek")
    fun createdMarker(tag: AccountTag) = File(root, "${tag.hex}.created")

    /** Any account files present in the root (used to refuse silent re-keying of the tag key). */
    private fun anyAccountFiles(): Boolean =
        root.listFiles()?.any { it.isFile && (it.name.endsWith(".db") || it.name.endsWith(".dek")) } == true

    /** Returns null (fail closed) if the tag key is missing while account files already exist. */
    fun accountTag(session: FakeVerifiedSession): AccountTag? {
        val existing = keyStore.getKey(tagAlias, null) as SecretKey?
        val key = existing ?: if (anyAccountFiles()) return null else generateTagKey()
        val mac = Mac.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256)
        mac.init(key)
        val digest = mac.doFinal(session.uid.toByteArray(Charsets.UTF_8))
        return AccountTag(digest.take(16).joinToString("") { "%02x".format(it) })
    }

    private fun generateTagKey(): SecretKey {
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, ANDROID_KEYSTORE)
        gen.init(KeyGenParameterSpec.Builder(tagAlias, KeyProperties.PURPOSE_SIGN).build())
        return gen.generateKey()
    }

    /** Create a new KEK and DEK. Refuses if any database or key file already exists for [tag]. */
    fun create(tag: AccountTag): KeyMaterial {
        check(!dbFile(tag).exists() && !dekFile(tag).exists()) { "refusing to create keys over existing account files" }
        val suffix = ByteArray(4).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        val alias = "${aliasPrefix}kek_v1_${tag.hex}_$suffix"
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        val kek = gen.generateKey()
        val dek = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, kek)
        cipher.updateAAD(aad(tag, alias))
        val iv = cipher.iv
        val ct = cipher.doFinal(dek)
        val aliasBytes = alias.toByteArray(Charsets.US_ASCII)
        val blob = MAGIC + byteArrayOf(aliasBytes.size.toByte()) + aliasBytes + byteArrayOf(iv.size.toByte()) + iv + ct
        writeAtomically(dekFile(tag), blob)
        return KeyMaterial(dek, alias)
    }

    fun unwrap(tag: AccountTag): UnwrapResult {
        val file = dekFile(tag)
        if (!file.exists()) return UnwrapResult.KeyMissing
        val blob = file.readBytes()
        val parsed = parse(blob) ?: return UnwrapResult.UnwrapFailed
        val (alias, iv, ct) = parsed
        val kek = try {
            keyStore.getKey(alias, null) as SecretKey? ?: return UnwrapResult.KeyMissing
        } catch (_: UnrecoverableKeyException) {
            return UnwrapResult.KeyMissing
        } catch (_: KeyStoreException) {
            return UnwrapResult.Transient
        }
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, kek, GCMParameterSpec(128, iv))
            cipher.updateAAD(aad(tag, alias))
            UnwrapResult.Ok(KeyMaterial(cipher.doFinal(ct), alias))
        } catch (_: AEADBadTagException) {
            UnwrapResult.UnwrapFailed
        } catch (_: KeyPermanentlyInvalidatedException) {
            UnwrapResult.KeyMissing
        } catch (_: ProviderException) {
            UnwrapResult.Transient
        }
    }

    /** Observed Keystore security level of [alias] as a code. Never assumed to be hardware-backed. */
    fun securityLevel(alias: String): String {
        val key = keyStore.getKey(alias, null) as SecretKey? ?: return "ALIAS_MISSING"
        val info = SecretKeyFactory.getInstance(key.algorithm, ANDROID_KEYSTORE).getKeySpec(key, KeyInfo::class.java) as KeyInfo
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return "PRE_API31_NOT_QUERIED"
        return when (info.securityLevel) {
            KeyProperties.SECURITY_LEVEL_SOFTWARE -> "SOFTWARE"
            KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "TRUSTED_ENVIRONMENT"
            KeyProperties.SECURITY_LEVEL_STRONGBOX -> "STRONGBOX"
            KeyProperties.SECURITY_LEVEL_UNKNOWN_SECURE -> "UNKNOWN_SECURE"
            else -> "UNKNOWN"
        }
    }

    fun aliasExists(alias: String): Boolean = keyStore.containsAlias(alias)

    /** Test cleanup only: every alias with this manager's prefix. */
    fun aliases(): List<String> = keyStore.aliases().toList().filter { it.startsWith(aliasPrefix) }

    fun deleteAlias(alias: String) = keyStore.deleteEntry(alias)

    private fun aad(tag: AccountTag, alias: String) = "bc-dek-v1|${tag.hex}|${tag.hex}.db|$alias".toByteArray(Charsets.US_ASCII)

    private fun parse(blob: ByteArray): Triple<String, ByteArray, ByteArray>? {
        if (blob.size < 6 || !blob.copyOfRange(0, 4).contentEquals(MAGIC)) return null
        val aliasLen = blob[4].toInt() and 0xFF
        val ivAt = 5 + aliasLen
        if (blob.size < ivAt + 1) return null
        val ivLen = blob[ivAt].toInt() and 0xFF
        val ctAt = ivAt + 1 + ivLen
        if (ivLen != 12 || blob.size != ctAt + 48) return null
        val alias = String(blob, 5, aliasLen, Charsets.US_ASCII)
        if (!alias.startsWith("${aliasPrefix}kek_v1_")) return null
        return Triple(alias, blob.copyOfRange(ivAt + 1, ctAt), blob.copyOfRange(ctAt, blob.size))
    }

    companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private val MAGIC = "BCD1".toByteArray(Charsets.US_ASCII)

        /** Write to a temp file, fsync, then atomically rename over [target]. */
        fun writeAtomically(target: File, bytes: ByteArray) {
            val tmp = File(target.parentFile, target.name + ".tmp")
            FileOutputStream(tmp).use { out ->
                out.write(bytes)
                out.fd.sync()
            }
            Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE)
        }
    }
}
