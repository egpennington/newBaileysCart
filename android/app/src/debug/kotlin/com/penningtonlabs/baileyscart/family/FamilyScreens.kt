package com.penningtonlabs.baileyscart.family

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.penningtonlabs.baileyscart.core.model.offline.ProjectedItem
import com.penningtonlabs.baileyscart.core.model.offline.SyncMark
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/*
 * BC-FAMILY-SYNC-01 Step 2 debug screens. Test tags are exposed as resource IDs so the two-emulator
 * harness can drive and read the real UI with `uiautomator dump` (no test dependency added).
 */

@Composable
fun FamilyHost(vm: FamilyViewModel) {
    Surface(
        Modifier
            .fillMaxSize()
            .semantics { testTagsAsResourceId = true },
    ) {
        Column(
            Modifier
                .safeDrawingPadding()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("FAMILY LIST — EMULATOR ONLY", style = MaterialTheme.typography.labelLarge, modifier = Modifier.testTag("banner"))
            when (val ui = vm.ui) {
                FamilyUi.Starting -> Text("Starting…")
                is FamilyUi.SignedOut -> SignedOutScreen(ui, vm)
                is FamilyUi.Unverified -> UnverifiedScreen(ui, vm)
                is FamilyUi.NoFamily -> NoFamilyScreen(ui, vm)
                is FamilyUi.InFamily -> InFamilyScreen(ui, vm)
                is FamilyUi.Revoked -> RevokedScreen(ui, vm)
            }
        }
    }
}

@Composable
private fun Message(text: String?) {
    if (text != null) Text(text, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("message"))
}

@Composable
private fun SignedOutScreen(ui: FamilyUi.SignedOut, vm: FamilyViewModel) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Text("Sign in to the Auth emulator", style = MaterialTheme.typography.titleMedium)
    OutlinedTextField(
        value = email,
        onValueChange = { email = it },
        label = { Text("Email") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        modifier = Modifier
            .fillMaxWidth()
            .testTag("email"),
    )
    OutlinedTextField(
        value = password,
        onValueChange = { password = it },
        label = { Text("Password") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        modifier = Modifier
            .fillMaxWidth()
            .testTag("password"),
    )
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = { vm.signUp(email, password) }, enabled = !ui.busy, modifier = Modifier.testTag("sign_up")) { Text("Create account") }
        OutlinedButton(onClick = { vm.signIn(email, password) }, enabled = !ui.busy, modifier = Modifier.testTag("sign_in")) { Text("Sign in") }
    }
    Message(ui.message)
}

@Composable
private fun UnverifiedScreen(ui: FamilyUi.Unverified, vm: FamilyViewModel) {
    Text("Verify ${ui.email}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.testTag("unverified"))
    Text("Open the verification link from the Auth emulator, then continue.")
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = vm::checkVerified, modifier = Modifier.testTag("verified")) { Text("I've verified") }
        OutlinedButton(onClick = vm::resendVerification, modifier = Modifier.testTag("resend")) { Text("Resend") }
        TextButton(onClick = vm::signOut, modifier = Modifier.testTag("sign_out")) { Text("Sign out") }
    }
    Message(ui.message)
}

@Composable
private fun NoFamilyScreen(ui: FamilyUi.NoFamily, vm: FamilyViewModel) {
    var code by remember { mutableStateOf("") }
    Text("No household yet", style = MaterialTheme.typography.titleMedium, modifier = Modifier.testTag("no_family"))
    Button(onClick = vm::createHousehold, enabled = !ui.busy, modifier = Modifier.testTag("create_household")) { Text("Create household") }
    OutlinedTextField(
        value = code,
        onValueChange = { code = it },
        label = { Text("Invitation code") },
        singleLine = true,
        modifier = Modifier
            .fillMaxWidth()
            .testTag("invite_input"),
    )
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { vm.join(code) }, enabled = !ui.busy && code.isNotBlank(), modifier = Modifier.testTag("join")) { Text("Join") }
        TextButton(onClick = vm::retryResolve, enabled = !ui.busy, modifier = Modifier.testTag("refresh")) { Text("Refresh") }
        TextButton(onClick = vm::signOut, modifier = Modifier.testTag("sign_out")) { Text("Sign out") }
    }
    if (ui.busy) Text("Working…", modifier = Modifier.testTag("busy"))
    Message(ui.message)
}

@Composable
private fun RevokedScreen(ui: FamilyUi.Revoked, vm: FamilyViewModel) {
    Text("You no longer have access to this family.", style = MaterialTheme.typography.titleMedium, modifier = Modifier.testTag("revoked"))
    Text(
        "${ui.unsent} change(s) weren't sent because you no longer have access to this family. " +
            "This device's copy was removed (${ui.outcome}).",
        modifier = Modifier.testTag("revoked_detail"),
    )
    Button(onClick = vm::acknowledgeRevoked, modifier = Modifier.testTag("revoked_ok")) { Text("OK") }
}

@Composable
private fun InFamilyScreen(ui: FamilyUi.InFamily, vm: FamilyViewModel) {
    when (val s = ui.screen) {
        EngineScreen.Opening -> Text("Opening the saved list…")
        is EngineScreen.Locked -> {
            Text("The saved list can't be opened (${s.reason}).", modifier = Modifier.testTag("locked"))
            TextButton(onClick = vm::signOut, modifier = Modifier.testTag("sign_out")) { Text("Sign out") }
        }
        is EngineScreen.Revoked -> Text("Checking access…")
        is EngineScreen.Ready -> ListScreen(s.view, ui, vm)
    }
}

@Composable
private fun ListScreen(view: FamilyView, ui: FamilyUi.InFamily, vm: FamilyViewModel) {
    var draft by remember { mutableStateOf("") }
    var draftError by remember { mutableStateOf<String?>(null) }
    Text("Shared shopping list", style = MaterialTheme.typography.titleMedium, modifier = Modifier.testTag("list_title"))
    Text(statusLine(view), modifier = Modifier.testTag("status"))
    if (view.pending > 0) Text("${view.pending} change(s) waiting to sync", modifier = Modifier.testTag("pending"))
    view.problems.forEach { Text("Not applied — $it", color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("problem")) }
    view.unreadable?.let { Text("The list can't be shown ($it).", color = MaterialTheme.colorScheme.error) }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = draft,
            onValueChange = {
                draft = it
                draftError = null
            },
            label = { Text("Item") },
            singleLine = true,
            modifier = Modifier
                .weight(1f)
                .testTag("item_input"),
        )
        Button(
            onClick = {
                draftError = vm.add(draft)
                if (draftError == null) draft = ""
            },
            modifier = Modifier.testTag("add"),
        ) { Text("Add") }
    }
    Message(draftError)
    LazyColumn(Modifier.fillMaxWidth().heightIn(max = 360.dp)) {
        items(view.items, key = { it.itemId.value }) { item -> ItemRow(item, vm) }
    }
    if (view.items.isEmpty()) Text("No items yet.", modifier = Modifier.testTag("empty"))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (ui.isOwner) OutlinedButton(onClick = vm::createInvite, modifier = Modifier.testTag("invite")) { Text("Invite") }
        TextButton(onClick = vm::signOut, modifier = Modifier.testTag("sign_out")) { Text("Sign out") }
    }
    ui.inviteCode?.let { Text(it, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.testTag("invite_code")) }
    Message(ui.message)
}

@Composable
private fun ItemRow(item: ProjectedItem, vm: FamilyViewModel) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .testTag("item:${item.name}"),
    ) {
        Checkbox(
            checked = item.checked,
            onCheckedChange = { vm.setChecked(item.itemId, it) },
            modifier = Modifier.testTag("check:${item.name}"),
        )
        Text(
            item.name + if (item.sync == SyncMark.PENDING) "  (waiting)" else "",
            modifier = Modifier
                .weight(1f)
                .testTag("name:${item.name}"),
        )
        TextButton(onClick = { vm.delete(item.itemId) }, modifier = Modifier.testTag("delete:${item.name}")) { Text("Delete") }
    }
}

private fun statusLine(view: FamilyView): String {
    val synced = view.lastSyncedAtMillis?.let { SimpleDateFormat("HH:mm:ss", Locale.US).format(Date(it)) }
    return when (view.connection) {
        Connection.CONNECTING -> "Connecting…"
        Connection.ONLINE -> "Online" + (synced?.let { " · synced $it" } ?: "")
        Connection.OFFLINE -> "Offline" + (synced?.let { ", last synced at $it" } ?: ", showing the saved list")
        Connection.CHECKING_ACCESS -> "Access is being checked"
        Connection.SIGN_IN_REFRESH -> "Refreshing sign-in…"
        Connection.ERROR -> "Can't sync right now; will retry when the app is reopened"
    }
}
