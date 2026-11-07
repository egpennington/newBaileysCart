package com.penningtonlabs.baileyscart.demo

import android.os.SystemClock
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalAccessibilityManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay

/** Minimum touch target for every action (Material and Android accessibility guidance). */
private val MinTouchTarget = 48.dp

@StringRes
internal fun DemoCategory.labelRes(): Int = when (this) {
    DemoCategory.PRODUCE -> com.penningtonlabs.baileyscart.R.string.demo_category_produce
    DemoCategory.DAIRY -> com.penningtonlabs.baileyscart.R.string.demo_category_dairy
    DemoCategory.DRY -> com.penningtonlabs.baileyscart.R.string.demo_category_dry
    DemoCategory.FROZEN -> com.penningtonlabs.baileyscart.R.string.demo_category_frozen
    DemoCategory.MISC -> com.penningtonlabs.baileyscart.R.string.demo_category_misc
    DemoCategory.MEAT -> com.penningtonlabs.baileyscart.R.string.demo_category_meat
}

/** Which dialog is open: none, Add, or Edit of a specific item. */
private sealed interface DialogMode {
    data object Add : DialogMode
    data class Edit(val item: DemoItem) : DialogMode
}

@Composable
fun ShoppingListDemoScreen(
    state: DemoListState,
    onAction: (DemoAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    var dialog by remember { mutableStateOf<DialogMode?>(null) }

    // Undo window: 5 s, extended by the user's accessibility "Time to take action" setting
    // when present (same mechanism Material snackbars use). Read at each delete so a setting
    // change applies immediately.
    val a11y = LocalAccessibilityManager.current
    val undoTimeoutMs: () -> Long = {
        a11y?.calculateRecommendedTimeoutMillis(
            LocalDemoList.UNDO_TIMEOUT_MS,
            containsIcons = false,
            containsText = true,
            containsControls = true,
        ) ?: LocalDemoList.UNDO_TIMEOUT_MS
    }

    // One timer per Undo slot, keyed by generation. A newer slot cancels the older timer, and
    // Expire carries the generation, so a late timer still cannot clear a newer slot.
    val undo = state.undo
    if (undo != null) {
        LaunchedEffect(undo.generation) {
            while (true) {
                val remaining = undo.expiresAtElapsedMs - SystemClock.elapsedRealtime()
                if (remaining <= 0L) break
                delay(remaining)
            }
            onAction(DemoAction.Expire(undo.generation, SystemClock.elapsedRealtime()))
        }
    }

    Scaffold(
        modifier = modifier,
        contentWindowInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal),
        topBar = { DemoHeader() },
        bottomBar = {
            DemoBottomBar(
                state = state,
                onUndo = { slot -> onAction(DemoAction.Undo(slot.generation, SystemClock.elapsedRealtime())) },
                onAdd = { dialog = DialogMode.Add },
            )
        },
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                top = innerPadding.calculateTopPadding() + 8.dp,
                bottom = innerPadding.calculateBottomPadding() + 8.dp,
                start = 16.dp,
                end = 16.dp,
            ),
        ) {
            item(key = "intro") { DemoIntro() }
            DemoCategory.entries.forEach { category ->
                item(key = "header-${category.name}") { CategoryHeader(category) }
                val categoryItems = state.itemsIn(category)
                if (categoryItems.isEmpty()) {
                    item(key = "empty-${category.name}") {
                        Text(
                            text = stringResource(com.penningtonlabs.baileyscart.R.string.demo_category_empty),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 12.dp),
                        )
                    }
                } else {
                    items(categoryItems, key = { "item-${it.id}" }) { item ->
                        ItemRow(
                            item = item,
                            onEdit = { dialog = DialogMode.Edit(item) },
                            onDelete = {
                                onAction(DemoAction.Delete(item.id, SystemClock.elapsedRealtime(), undoTimeoutMs()))
                            },
                        )
                    }
                }
            }
        }
    }

    when (val mode = dialog) {
        null -> Unit
        DialogMode.Add -> ItemDialog(
            titleRes = com.penningtonlabs.baileyscart.R.string.demo_dialog_add_title,
            confirmRes = com.penningtonlabs.baileyscart.R.string.demo_add_item,
            initialName = "",
            initialCategory = DemoCategory.PRODUCE,
            onDismiss = { dialog = null },
            onConfirm = { name, category ->
                onAction(DemoAction.Add(name, category))
                dialog = null
            },
        )
        is DialogMode.Edit -> ItemDialog(
            titleRes = com.penningtonlabs.baileyscart.R.string.demo_dialog_edit_title,
            confirmRes = com.penningtonlabs.baileyscart.R.string.demo_save,
            initialName = mode.item.name,
            initialCategory = mode.item.category,
            onDismiss = { dialog = null },
            onConfirm = { name, category ->
                onAction(DemoAction.Edit(mode.item.id, name, category))
                dialog = null
            },
        )
    }
}

@Composable
private fun DemoHeader() {
    Surface(color = MaterialTheme.colorScheme.tertiaryContainer) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
                .padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            // Only the scope indicator is pinned, so the list keeps room at 200% font scale.
            Text(
                text = stringResource(com.penningtonlabs.baileyscart.R.string.demo_banner),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onTertiaryContainer,
            )
        }
    }
}

/** Scrolls with the list: the demo-scope explanation and the screen title. */
@Composable
private fun DemoIntro() {
    Column(Modifier.padding(top = 4.dp)) {
        Text(
            text = stringResource(com.penningtonlabs.baileyscart.R.string.demo_banner_detail),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = stringResource(com.penningtonlabs.baileyscart.R.string.demo_title),
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier
                .padding(top = 8.dp)
                .semantics { heading() },
        )
    }
}

@Composable
private fun CategoryHeader(category: DemoCategory) {
    Column(Modifier.padding(top = 16.dp)) {
        Text(
            text = stringResource(category.labelRes()),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.semantics { heading() },
        )
        HorizontalDivider(Modifier.padding(top = 4.dp))
    }
}

@Composable
private fun ItemRow(item: DemoItem, onEdit: () -> Unit, onDelete: () -> Unit) {
    val categoryLabel = stringResource(item.category.labelRes())
    val editCd = stringResource(com.penningtonlabs.baileyscart.R.string.demo_edit_cd, item.name, categoryLabel)
    val deleteCd = stringResource(com.penningtonlabs.baileyscart.R.string.demo_delete_cd, item.name, categoryLabel)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = MinTouchTarget),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = item.name,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier
                .weight(1f)
                .padding(vertical = 8.dp),
        )
        TextButton(
            onClick = onEdit,
            modifier = Modifier
                .heightIn(min = MinTouchTarget)
                .semantics { contentDescription = editCd },
        ) { Text(stringResource(com.penningtonlabs.baileyscart.R.string.demo_edit)) }
        TextButton(
            onClick = onDelete,
            modifier = Modifier
                .heightIn(min = MinTouchTarget)
                .semantics { contentDescription = deleteCd },
        ) { Text(stringResource(com.penningtonlabs.baileyscart.R.string.demo_delete)) }
    }
}

@Composable
private fun DemoBottomBar(state: DemoListState, onUndo: (UndoSlot) -> Unit, onAdd: () -> Unit) {
    Surface(tonalElevation = 3.dp) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            val event = state.lastEvent
            if (event != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    // Single polite live region: TalkBack announces add, edit, delete and
                    // restore results without moving focus.
                    Text(
                        text = eventText(event),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier
                            .weight(1f)
                            .semantics { liveRegion = LiveRegionMode.Polite },
                    )
                    val slot = state.undo
                    if (slot != null) {
                        val undoCd = stringResource(com.penningtonlabs.baileyscart.R.string.demo_undo_cd, slot.item.name)
                        OutlinedButton(
                            onClick = { onUndo(slot) },
                            modifier = Modifier
                                .heightIn(min = MinTouchTarget)
                                .semantics { contentDescription = undoCd },
                        ) { Text(stringResource(com.penningtonlabs.baileyscart.R.string.demo_undo)) }
                    }
                }
            }
            Button(
                onClick = onAdd,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = MinTouchTarget),
            ) { Text(stringResource(com.penningtonlabs.baileyscart.R.string.demo_add_item)) }
        }
    }
}

@Composable
private fun eventText(event: DemoEvent): String {
    val category = stringResource(event.item.category.labelRes())
    val res = when (event) {
        is DemoEvent.Added -> com.penningtonlabs.baileyscart.R.string.demo_event_added
        is DemoEvent.Updated -> com.penningtonlabs.baileyscart.R.string.demo_event_updated
        is DemoEvent.Deleted -> com.penningtonlabs.baileyscart.R.string.demo_event_deleted
        is DemoEvent.Restored -> com.penningtonlabs.baileyscart.R.string.demo_event_restored
    }
    return stringResource(res, event.item.name, category)
}

@Composable
private fun ItemDialog(
    @StringRes titleRes: Int,
    @StringRes confirmRes: Int,
    initialName: String,
    initialCategory: DemoCategory,
    onDismiss: () -> Unit,
    onConfirm: (String, DemoCategory) -> Unit,
) {
    var name by remember { mutableStateOf(initialName) }
    var category by remember { mutableStateOf(initialCategory) }
    var showError by remember { mutableStateOf(false) }
    val check = LocalDemoList.validateName(name)
    val focusRequester = remember { FocusRequester() }

    val submit: () -> Unit = {
        if (check is NameCheck.Valid) {
            onConfirm(check.name, category)
        } else {
            showError = true
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        // The dialog handles insets itself and pads above the keyboard, so the Save/Cancel
        // buttons stay visible and the field and category list scroll in the remaining space.
        properties = DialogProperties(decorFitsSystemWindows = false),
        modifier = Modifier
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .imePadding(),
        title = { Text(stringResource(titleRes)) },
        text = {
            // Scrolls so the field, all six options and the error stay reachable at 200% font.
            Column(Modifier.verticalScroll(rememberScrollState())) {
                val errorRes = when (check) {
                    NameCheck.Blank -> com.penningtonlabs.baileyscart.R.string.demo_name_error_blank
                    NameCheck.TooLong -> com.penningtonlabs.baileyscart.R.string.demo_name_error_too_long
                    is NameCheck.Valid -> null
                }
                val visibleError = errorRes?.takeIf { showError || check is NameCheck.TooLong }
                OutlinedTextField(
                    value = name,
                    onValueChange = {
                        name = it
                        showError = false
                    },
                    label = { Text(stringResource(com.penningtonlabs.baileyscart.R.string.demo_name_label)) },
                    singleLine = true,
                    isError = visibleError != null,
                    supportingText = visibleError?.let { res -> { Text(stringResource(res)) } },
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Sentences,
                        imeAction = ImeAction.Done,
                    ),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                    modifier = Modifier
                        .fillMaxWidth()
                        .focusRequester(focusRequester),
                )
                Text(
                    text = stringResource(com.penningtonlabs.baileyscart.R.string.demo_category_label),
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier
                        .padding(top = 12.dp, bottom = 4.dp)
                        .semantics { heading() },
                )
                Column(Modifier.selectableGroup()) {
                    DemoCategory.entries.forEach { option ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = MinTouchTarget)
                                .selectable(
                                    selected = option == category,
                                    onClick = { category = option },
                                    role = Role.RadioButton,
                                ),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = option == category, onClick = null)
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(option.labelRes()), style = MaterialTheme.typography.bodyLarge)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = submit, modifier = Modifier.heightIn(min = MinTouchTarget)) {
                Text(stringResource(confirmRes))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = MinTouchTarget)) {
                Text(stringResource(com.penningtonlabs.baileyscart.R.string.demo_cancel))
            }
        },
    )

    LaunchedEffect(Unit) { focusRequester.requestFocus() }
}
