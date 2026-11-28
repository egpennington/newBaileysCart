package com.penningtonlabs.baileyscart.family

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.FirebaseFirestoreSettings
import com.google.firebase.firestore.MemoryCacheSettings
import com.google.firebase.firestore.MetadataChanges
import com.penningtonlabs.baileyscart.core.model.offline.Category
import com.penningtonlabs.baileyscart.core.model.offline.ItemCommand
import com.penningtonlabs.baileyscart.core.model.offline.ItemId
import com.penningtonlabs.baileyscart.core.model.offline.OutboxOperation
import com.penningtonlabs.baileyscart.core.model.offline.ServerItem
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executor

/**
 * BC-FAMILY-SYNC-01 Step 2 (debug source set only; Sync Contract Rev 2 section 6): the Firebase
 * client, pointed ONLY at the local Emulator Suite. There is no google-services.json, the project ID
 * is the `demo-` emulator project, and the app ID and API key below are fixed placeholders that no
 * real Firebase project accepts. The release source set contains none of this
 * (scripts/check-release-isolation.sh).
 */
object EmulatorFirebase {
    const val PROJECT_ID = "demo-newbaileyscart"

    /** The Android emulator's address for the host machine (network_security_config allows only this). */
    const val HOST = "10.0.2.2"
    const val AUTH_PORT = 9099
    const val FIRESTORE_PORT = 8080
    const val FUNCTIONS_PORT = 5001

    private const val APP_NAME = "bc-family-sync-emulator"

    @Volatile private var app: FirebaseApp? = null

    @Synchronized
    fun app(context: Context): FirebaseApp {
        app?.let { return it }
        val options = FirebaseOptions.Builder()
            .setProjectId(PROJECT_ID)
            .setApplicationId("1:000000000000:android:0000000000000000")
            .setApiKey("demo-emulator-only-not-a-key")
            .build()
        val created = FirebaseApp.initializeApp(context.applicationContext, options, APP_NAME)
        FirebaseAuth.getInstance(created).useEmulator(HOST, AUTH_PORT)
        FirebaseFirestore.getInstance(created).apply {
            useEmulator(HOST, FIRESTORE_PORT)
            // Rev 2 section 5: memory-only cache. SQLCipher stays the only persistent copy.
            firestoreSettings = FirebaseFirestoreSettings.Builder()
                .setLocalCacheSettings(MemoryCacheSettings.newBuilder().build())
                .build()
        }
        app = created
        return created
    }
}

/**
 * Callables over the Functions EMULATOR, using the callable HTTP protocol directly (POST
 * `{"data": ...}` with the Auth ID token as a Bearer token; the reply is `{"result": ...}` or
 * `{"error": {status, message, details}}`). The firebase-functions SDK is deliberately not used: it
 * requires firebase-iid, which contacts Google's production Installations service.
 * Every callback is delivered on [callbacks]; network I/O runs on [FamilySyncRuntime.io].
 */
class EmulatorBackend(context: Context, private val callbacks: Executor) : FamilyBackend {
    private val auth = FirebaseAuth.getInstance(EmulatorFirebase.app(context))

    override fun getSession(done: (CallResult<List<SessionFamily>>) -> Unit) =
        call("accountGetSession", mapOf("apiVersion" to API_VERSION), done) { data ->
            (data["joinedFamilies"] as? List<*>).orEmpty().mapNotNull { f ->
                val m = f as? Map<*, *> ?: return@mapNotNull null
                val id = m["familyId"] as? String ?: return@mapNotNull null
                SessionFamily(id, m["role"] as? String ?: "", m["accessMode"] as? String ?: "NONE")
            }
        }

    override fun createFamily(opId: String, done: (CallResult<FamilyRef>) -> Unit) =
        call("familiesCreate", mapOf("apiVersion" to API_VERSION, "opId" to opId, "payload" to emptyMap<String, Any>()), done, ::familyRef)

    override fun createInvite(opId: String, familyId: String, familyEpoch: Long, done: (CallResult<String>) -> Unit) =
        call(
            "invitesCreate",
            mapOf("apiVersion" to API_VERSION, "opId" to opId, "familyId" to familyId, "familyEpoch" to familyEpoch),
            done,
        ) { data -> data["code"] as? String ?: throw IllegalStateException("no invite code") }

    override fun acceptInvite(opId: String, code: String, done: (CallResult<FamilyRef>) -> Unit) =
        call("invitesAccept", mapOf("apiVersion" to API_VERSION, "opId" to opId, "code" to code), done, ::familyRef)

    override fun send(familyId: String, op: OutboxOperation, done: (CallResult<Long>) -> Unit) {
        val base = mapOf(
            "apiVersion" to API_VERSION,
            "opId" to op.opId.value,
            "familyId" to familyId,
            "familyEpoch" to op.epoch.value,
            "itemId" to op.command.itemId.value,
        )
        val (name, body) = when (val c = op.command) {
            is ItemCommand.Add -> "itemsAdd" to base + mapOf("name" to c.name.display, "category" to c.category.name)
            is ItemCommand.Edit -> "itemsEdit" to base + mapOf(
                "patch" to buildMap {
                    c.name?.let { put("name", it.display) }
                    c.category?.let { put("category", it.name) }
                    c.checked?.let { put("checked", it) }
                },
            )
            is ItemCommand.Delete -> "itemsDelete" to base
            is ItemCommand.UndoDelete -> "itemsUndoDelete" to base + mapOf("deleteOpId" to c.deleteOpId.value)
        }
        call(name, body, done) { data -> (data["rev"] as? Number)?.toLong() ?: throw IllegalStateException("no rev") }
    }

    override fun refreshToken(done: (Boolean) -> Unit) {
        val user = auth.currentUser
        if (user == null) {
            callbacks.execute { done(false) }
            return
        }
        user.getIdToken(true).addOnCompleteListener(callbacks) { done(it.isSuccessful) }
    }

    private fun <T> call(
        name: String,
        body: Map<String, Any>,
        done: (CallResult<T>) -> Unit,
        parse: (Map<*, *>) -> T,
    ) {
        val user = auth.currentUser
        if (user == null) {
            callbacks.execute { done(CallResult.Unauthenticated) }
            return
        }
        user.getIdToken(false).addOnCompleteListener(FamilySyncRuntime.io) { t ->
            val token = if (t.isSuccessful) t.result?.token else null
            // No token (for example offline with an expired token): no server decision.
            val result: CallResult<T> = if (token == null) CallResult.Unreachable else post(name, token, body, parse)
            // Outcome class only: no request data, names, tokens or uids.
            FamilySyncRuntime.trace("op=CALL name=$name result=${traceOf(result)}")
            callbacks.execute { done(result) }
        }
    }

    private fun <T> post(name: String, token: String, body: Map<String, Any>, parse: (Map<*, *>) -> T): CallResult<T> {
        val url = URL("http://${EmulatorFirebase.HOST}:${EmulatorFirebase.FUNCTIONS_PORT}/${EmulatorFirebase.PROJECT_ID}/$REGION/$name")
        val conn = url.openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = "POST"
            conn.connectTimeout = TIMEOUT_MS
            conn.readTimeout = TIMEOUT_MS
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.outputStream.use { it.write(JSONObject(mapOf("data" to body)).toString().toByteArray(Charsets.UTF_8)) }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) }
            resultOf(status, text?.let(::parseJson), parse)
        } catch (_: IOException) {
            CallResult.Unreachable
        } finally {
            conn.disconnect()
        }
    }

    private fun familyRef(data: Map<*, *>): FamilyRef = FamilyRef(
        data["familyId"] as? String ?: throw IllegalStateException("no familyId"),
        (data["familyEpoch"] as? Number)?.toLong() ?: throw IllegalStateException("no familyEpoch"),
    )

    companion object {
        const val API_VERSION = "v0.4"

        private const val REGION = "us-central1"
        private const val TIMEOUT_MS = 15_000

        private fun traceOf(r: CallResult<*>): String = when (r) {
            is CallResult.Rejected -> "Rejected code=${r.code}"
            else -> r::class.simpleName ?: "?"
        }

        /** JSON text to plain Kotlin maps and lists; null when it is not a JSON object. */
        private fun parseJson(text: String): Map<*, *>? = try {
            plain(JSONObject(text)) as? Map<*, *>
        } catch (_: Exception) {
            null
        }

        private fun plain(v: Any?): Any? = when (v) {
            is JSONObject -> v.keys().asSequence().associateWith { plain(v.opt(it)) }
            is JSONArray -> (0 until v.length()).map { plain(v.opt(it)) }
            JSONObject.NULL -> null
            else -> v
        }

        /**
         * Map one callable HTTP reply. Only an API v0.4 rejection envelope (HttpsError details) is a
         * server decision; everything else is Unreachable or Unauthenticated, never a revocation.
         */
        internal fun <T> resultOf(status: Int, json: Map<*, *>?, parse: (Map<*, *>) -> T): CallResult<T> {
            if (json == null) return CallResult.Unreachable
            if (status in 200..299) {
                val envelope = json["result"] as? Map<*, *> ?: return CallResult.Unreachable
                val payload = envelope["data"] as? Map<*, *> ?: return CallResult.Unreachable
                return try {
                    CallResult.Ok(parse(payload))
                } catch (_: Exception) {
                    CallResult.Rejected("CLIENT_PARSE_FAILED", retryable = false)
                }
            }
            val error = json["error"] as? Map<*, *> ?: return CallResult.Unreachable
            val rejection = (error["details"] as? Map<*, *>)?.get("error") as? Map<*, *>
            val code = rejection?.get("code") as? String
            if (code != null) {
                if (code == "UNAUTHENTICATED") return CallResult.Unauthenticated
                return CallResult.Rejected(code, rejection["retryable"] == true)
            }
            // No envelope: a proxy, a timeout page or an emulator that is not ready. No decision.
            return if (error["status"] == "UNAUTHENTICATED") CallResult.Unauthenticated else CallResult.Unreachable
        }
    }
}

/** Firestore listeners on the read model (Rev 2 section 1). Events are delivered on [callbacks]. */
class FirestoreListHub(context: Context, private val callbacks: Executor) : ListHub {
    private val firestore = FirebaseFirestore.getInstance(EmulatorFirebase.app(context))

    override fun attach(familyId: String, onEvent: (ListEvent) -> Unit): ListHub.Attachment {
        val family = firestore.collection("families").document(familyId)
        val items = family.collection("listItems").addSnapshotListener(callbacks, MetadataChanges.INCLUDE) { snap, error ->
            when {
                error != null -> onEvent(ListEvent.Failed(listenError(error)))
                snap != null -> onEvent(
                    itemsOf(snap.documents)?.let { ListEvent.Items(it, snap.metadata.isFromCache) } ?: ListEvent.Failed(ListenError.OTHER),
                )
            }
        }
        val meta = family.collection("listMeta").document("current").addSnapshotListener(callbacks, MetadataChanges.INCLUDE) { snap, error ->
            when {
                error != null -> onEvent(ListEvent.Failed(listenError(error)))
                snap != null -> onEvent(
                    ListEvent.Meta(if (snap.exists()) snap.getLong("familyEpoch") else null, snap.metadata.isFromCache),
                )
            }
        }
        return ListHub.Attachment {
            items.remove()
            meta.remove()
        }
    }

    override fun setNetworkEnabled(enabled: Boolean) {
        if (enabled) firestore.enableNetwork() else firestore.disableNetwork()
    }

    private fun listenError(e: FirebaseFirestoreException): ListenError = when (e.code) {
        FirebaseFirestoreException.Code.PERMISSION_DENIED -> ListenError.PERMISSION_DENIED
        FirebaseFirestoreException.Code.UNAUTHENTICATED -> ListenError.UNAUTHENTICATED
        FirebaseFirestoreException.Code.UNAVAILABLE -> ListenError.UNAVAILABLE
        else -> ListenError.OTHER
    }

    /** Fail closed: one malformed read-model document makes the whole event unusable. */
    private fun itemsOf(docs: List<DocumentSnapshot>): List<ServerItem>? = docs.map { d ->
        val id = ItemId.parse(d.id) ?: return null
        val name = d.getString("name") ?: return null
        val category = d.getString("category")?.let { c -> Category.entries.firstOrNull { it.name == c } } ?: return null
        val checked = d.getBoolean("checked") ?: return null
        val rev = d.getLong("rev") ?: return null
        ServerItem(id, name, category, rev, checked = checked)
    }
}
