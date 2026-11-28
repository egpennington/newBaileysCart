package com.penningtonlabs.baileyscart.family

import android.app.Application
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.edit
import androidx.lifecycle.AndroidViewModel
import com.google.firebase.auth.FirebaseAuth
import com.penningtonlabs.baileyscart.core.model.offline.ItemId
import com.penningtonlabs.baileyscart.core.model.offline.ItemName
import com.penningtonlabs.baileyscart.core.model.offline.NameValidation
import java.util.UUID
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/** Process-wide threads for the family sync debug app (debug source set only). */
internal object FamilySyncRuntime {
    /** Logcat tag of the BC-FAMILY-SYNC-01 trace. Must never appear in a release build. */
    const val TRACE_TAG = "BCFS-TRACE"

    /** One serial thread: every engine task, store call and adapter callback, in order. */
    val serial: Executor = Executors.newSingleThreadExecutor { r -> Thread(r, "family-sync") }

    /** Callable HTTP I/O, so a slow request never blocks [serial]. */
    val io: Executor = Executors.newSingleThreadExecutor { r -> Thread(r, "family-sync-io") }

    private val timer: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "family-sync-retry") }

    val scheduler = RetryScheduler { delayMillis, task ->
        val f = timer.schedule(task, delayMillis, TimeUnit.MILLISECONDS)
        return@RetryScheduler { f.cancel(false) }
    }

    private val seq = AtomicLong()

    /** No list contents, names, emails, tokens or uids are traced. */
    fun trace(line: String) {
        Log.i(TRACE_TAG, "seq=${seq.incrementAndGet()} $line")
    }
}

sealed interface FamilyUi {
    data object Starting : FamilyUi

    data class SignedOut(val busy: Boolean = false, val message: String? = null) : FamilyUi

    data class Unverified(val email: String, val message: String? = null) : FamilyUi

    data class NoFamily(val busy: Boolean = false, val message: String? = null) : FamilyUi

    data class InFamily(
        val screen: EngineScreen,
        val isOwner: Boolean,
        val inviteCode: String? = null,
        val message: String? = null,
    ) : FamilyUi

    data class Revoked(val unsent: Int, val outcome: PurgeOutcome) : FamilyUi
}

/**
 * BC-FAMILY-SYNC-01 Step 2: the debug family-sharing screen state. Signs in to the Auth EMULATOR
 * with email and password (verification through the emulator's out-of-band link), finds or creates
 * a household with the Step 1 callables, and runs one [FamilySyncEngine] for it.
 */
class FamilyViewModel(application: Application) : AndroidViewModel(application) {
    var ui: FamilyUi by mutableStateOf(FamilyUi.Starting)
        private set

    private val main = Handler(Looper.getMainLooper())
    private val mainExecutor = Executor { main.post(it) }
    private val auth = FirebaseAuth.getInstance(EmulatorFirebase.app(application))
    private val backend = EmulatorBackend(application, mainExecutor)
    private val prefs = application.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private var engine: FamilySyncEngine? = null
    private var familyId: String? = null
    private var familyEpoch: Long = 1
    private var isOwner = false
    private var visible = false

    /** Reused until the command succeeds, so a retry is the same operation (idempotency). */
    private var pendingCreateOpId: String? = null
    private var pendingInviteOpId: String? = null
    private var pendingJoin: Pair<String, String>? = null

    init {
        FamilySyncRuntime.trace("op=VM_CREATED")
        resume()
    }

    // ---- lifecycle (Activity) ----------------------------------------------------------------

    fun onVisible() {
        visible = true
        engine?.onVisible()
    }

    fun onHidden() {
        visible = false
        engine?.onHidden()
    }

    fun onNetwork(available: Boolean) {
        if (available) engine?.onNetworkAvailable() else engine?.onNetworkLost()
    }

    // ---- auth ----------------------------------------------------------------------------------

    fun signUp(email: String, password: String) = authStep(email) {
        auth.createUserWithEmailAndPassword(email.trim(), password).addOnCompleteListener(mainExecutor) { t ->
            // Task.result throws on a failed task: check success first (offline sign-up must not crash).
            val user = if (t.isSuccessful) t.result?.user else null
            if (user == null) {
                ui = FamilyUi.SignedOut(message = "Couldn't create the account: ${t.exception?.javaClass?.simpleName}")
                return@addOnCompleteListener
            }
            user.sendEmailVerification().addOnCompleteListener(mainExecutor) {
                ui = FamilyUi.Unverified(email.trim(), "Verification email sent (emulator).")
            }
        }
    }

    fun signIn(email: String, password: String) = authStep(email) {
        auth.signInWithEmailAndPassword(email.trim(), password).addOnCompleteListener(mainExecutor) { t ->
            if (!t.isSuccessful) {
                ui = FamilyUi.SignedOut(message = "Couldn't sign in: ${t.exception?.javaClass?.simpleName}")
            } else {
                resume()
            }
        }
    }

    private inline fun authStep(email: String, step: () -> Unit) {
        if (email.isBlank()) {
            ui = FamilyUi.SignedOut(message = "Enter an email address.")
            return
        }
        ui = FamilyUi.SignedOut(busy = true)
        step()
    }

    /** "I've verified": reload the user, then force a fresh ID token carrying email_verified. */
    fun checkVerified() {
        val user = auth.currentUser ?: return resume()
        user.reload().addOnCompleteListener(mainExecutor) {
            val fresh = auth.currentUser
            if (fresh == null || !fresh.isEmailVerified) {
                ui = FamilyUi.Unverified(fresh?.email ?: "", "Not verified yet.")
                return@addOnCompleteListener
            }
            fresh.getIdToken(true).addOnCompleteListener(mainExecutor) { resume() }
        }
    }

    fun resendVerification() {
        auth.currentUser?.sendEmailVerification()?.addOnCompleteListener(mainExecutor) {
            ui = FamilyUi.Unverified(auth.currentUser?.email ?: "", "Verification email sent again.")
        }
    }

    fun signOut() {
        closeEngine()
        auth.signOut()
        ui = FamilyUi.SignedOut()
    }

    // ---- household -----------------------------------------------------------------------------

    private fun resume() {
        val user = auth.currentUser
        when {
            user == null -> ui = FamilyUi.SignedOut()
            !user.isEmailVerified -> ui = FamilyUi.Unverified(user.email ?: "")
            else -> resolveFamily(user.uid)
        }
    }

    /**
     * Opens the family the server reports. Offline, it opens the family this user last used on this
     * device, from its encrypted saved copy. A saved family the server no longer lists is still
     * opened: the engine's session check confirms the loss of access and purges it.
     */
    private fun resolveFamily(uid: String) {
        ui = FamilyUi.NoFamily(busy = true)
        val last = prefs.getString(lastFamilyKey(uid), null)
        backend.getSession { r ->
            when (r) {
                is CallResult.Ok -> {
                    val usable = r.value.filter { it.accessMode != "NONE" }
                    val pick = usable.firstOrNull { it.familyId == last } ?: usable.firstOrNull()
                    when {
                        last != null && usable.none { it.familyId == last } -> openFamily(uid, last, null, owner = false)
                        pick != null -> openFamily(uid, pick.familyId, null, owner = pick.role == "OWNER")
                        else -> ui = FamilyUi.NoFamily()
                    }
                }
                else -> if (last != null) {
                    openFamily(uid, last, null, owner = prefs.getBoolean(ownerKey(uid), false))
                } else {
                    ui = FamilyUi.NoFamily(message = "Can't reach the emulator. Try again.")
                }
            }
        }
    }

    fun retryResolve() = resume()

    fun createHousehold() {
        val uid = auth.currentUser?.uid ?: return
        val opId = pendingCreateOpId ?: UUID.randomUUID().toString().also { pendingCreateOpId = it }
        ui = FamilyUi.NoFamily(busy = true)
        backend.createFamily(opId) { r ->
            when (r) {
                is CallResult.Ok -> {
                    pendingCreateOpId = null
                    openFamily(uid, r.value.familyId, r.value.familyEpoch, owner = true)
                }
                else -> ui = FamilyUi.NoFamily(message = "Couldn't create the household: ${describe(r)}")
            }
        }
    }

    fun join(rawCode: String) {
        val uid = auth.currentUser?.uid ?: return
        val code = rawCode.trim().uppercase()
        val pending = pendingJoin
        val opId = if (pending != null && pending.first == code) pending.second else UUID.randomUUID().toString()
        pendingJoin = code to opId
        ui = FamilyUi.NoFamily(busy = true)
        backend.acceptInvite(opId, code) { r ->
            when (r) {
                is CallResult.Ok -> {
                    pendingJoin = null
                    openFamily(uid, r.value.familyId, r.value.familyEpoch, owner = false)
                }
                else -> ui = FamilyUi.NoFamily(message = "Couldn't join: ${describe(r)}")
            }
        }
    }

    fun createInvite() {
        val fid = familyId ?: return
        val opId = pendingInviteOpId ?: UUID.randomUUID().toString().also { pendingInviteOpId = it }
        backend.createInvite(opId, fid, familyEpoch) { r ->
            val current = ui as? FamilyUi.InFamily ?: return@createInvite
            ui = when (r) {
                is CallResult.Ok -> {
                    pendingInviteOpId = null
                    current.copy(inviteCode = r.value, message = null)
                }
                else -> current.copy(message = "Couldn't create an invite: ${describe(r)}")
            }
        }
    }

    private fun openFamily(uid: String, fid: String, epoch: Long?, owner: Boolean) {
        closeEngine()
        familyId = fid
        familyEpoch = epoch ?: 1
        isOwner = owner
        prefs.edit {
            putString(lastFamilyKey(uid), fid)
            putBoolean(ownerKey(uid), owner)
        }
        ui = FamilyUi.InFamily(EngineScreen.Opening, owner)
        val e = FamilySyncEngine(
            uid = uid,
            familyId = fid,
            epochHint = epoch,
            stores = EncryptedFamilyStore(getApplication()),
            backend = EmulatorBackend(getApplication(), FamilySyncRuntime.serial),
            hub = FirestoreListHub(getApplication(), FamilySyncRuntime.serial),
            serial = FamilySyncRuntime.serial,
            scheduler = FamilySyncRuntime.scheduler,
            clock = System::currentTimeMillis,
            publish = { screen -> main.post { onEngineScreen(uid, screen) } },
            trace = FamilySyncRuntime::trace,
        )
        engine = e
        e.start()
        if (visible) e.onVisible()
    }

    private fun onEngineScreen(uid: String, screen: EngineScreen) {
        if (engine == null) return
        if (screen is EngineScreen.Revoked) {
            prefs.edit {
                remove(lastFamilyKey(uid))
                remove(ownerKey(uid))
            }
            closeEngine()
            ui = FamilyUi.Revoked(screen.unsent, screen.outcome)
            return
        }
        val current = ui as? FamilyUi.InFamily
        ui = FamilyUi.InFamily(screen, isOwner, current?.inviteCode, current?.message)
    }

    fun acknowledgeRevoked() = resume()

    // ---- list ----------------------------------------------------------------------------------

    /** Returns an error message, or null when the item was queued. */
    fun add(raw: String): String? = when (val v = ItemName.validate(raw)) {
        is NameValidation.Valid -> {
            engine?.add(v.name)
            null
        }
        is NameValidation.Invalid -> "That name can't be used."
    }

    fun setChecked(itemId: ItemId, checked: Boolean) {
        engine?.setChecked(itemId, checked)
    }

    fun delete(itemId: ItemId) {
        engine?.delete(itemId)
    }

    private fun closeEngine() {
        engine?.close()
        engine = null
        familyId = null
    }

    override fun onCleared() {
        FamilySyncRuntime.trace("op=VM_CLEARED")
        closeEngine()
    }

    private fun describe(r: CallResult<*>): String = when (r) {
        is CallResult.Ok -> "OK"
        is CallResult.Rejected -> r.code
        CallResult.Unauthenticated -> "UNAUTHENTICATED"
        CallResult.Unreachable -> "the emulator can't be reached"
    }

    private companion object {
        const val PREFS = "bc_family_sync_debug"

        /** The family ID only (no list data): which saved store to open while offline. */
        fun lastFamilyKey(uid: String) = "lastFamily:" + EncryptedFamilyStore.storageIdentity(uid, "")

        fun ownerKey(uid: String) = "owner:" + EncryptedFamilyStore.storageIdentity(uid, "")
    }
}
