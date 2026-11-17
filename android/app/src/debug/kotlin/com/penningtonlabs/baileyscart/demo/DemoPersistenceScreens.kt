package com.penningtonlabs.baileyscart.demo

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.penningtonlabs.baileyscart.R
import com.penningtonlabs.baileyscart.demo.persist.DemoNotice
import com.penningtonlabs.baileyscart.demo.persist.DemoScreen

/*
 * BC-S2-LOCAL-PERSIST LP-2 screens around the LOCAL DEMO list (debug source set only): opening,
 * locked (fail closed), save failed (read-only) and the two-step reset confirmation.
 */

private val MinTouchTarget = 48.dp

/** Reset confirmation progress. Cancel at either step returns to [NONE] and changes nothing. */
private enum class ResetStep { NONE, EXPLAIN, CONFIRM }

@Composable
fun DemoHost(
    screen: DemoScreen,
    onAction: (DemoAction) -> Unit,
    onReload: () -> Unit,
    onConfirmedReset: () -> Unit,
) {
    var resetStep by rememberSaveable { mutableStateOf(ResetStep.NONE) }
    val lockedReset = screen is DemoScreen.Locked

    when (screen) {
        DemoScreen.Opening -> StatusScreen(R.string.demo_store_opening)
        DemoScreen.Resetting -> StatusScreen(R.string.demo_store_resetting)
        is DemoScreen.Ready -> ShoppingListDemoScreen(
            state = screen.list,
            onAction = onAction,
            notice = screen.notice?.let { n -> { NoticeText(n) } },
            onResetRequest = { resetStep = ResetStep.EXPLAIN },
        )
        is DemoScreen.SaveFailed -> ShoppingListDemoScreen(
            state = screen.list,
            onAction = onAction,
            editable = false,
            notice = { SaveFailedNotice(onReload) },
            onResetRequest = { resetStep = ResetStep.EXPLAIN },
        )
        is DemoScreen.Locked -> LockedScreen(
            screen = screen,
            onRetry = onReload,
            onResetRequest = { resetStep = ResetStep.EXPLAIN },
        )
    }

    val canReset = when (screen) {
        is DemoScreen.Ready, is DemoScreen.SaveFailed -> true
        is DemoScreen.Locked -> screen.canReset
        DemoScreen.Opening, DemoScreen.Resetting -> false
    }
    // A dialog opened on a screen that can no longer reset (for example while a reset or reload
    // runs) is closed, not carried over to the next screen.
    LaunchedEffect(canReset) { if (!canReset) resetStep = ResetStep.NONE }
    if (!canReset) return
    when (resetStep) {
        ResetStep.NONE -> Unit
        ResetStep.EXPLAIN -> ResetDialog(
            titleRes = R.string.demo_reset_title,
            bodyRes = if (lockedReset) R.string.demo_reset_body_locked else R.string.demo_reset_body,
            confirmRes = R.string.demo_reset_continue,
            onCancel = { resetStep = ResetStep.NONE },
            onConfirm = { resetStep = ResetStep.CONFIRM },
        )
        ResetStep.CONFIRM -> ResetDialog(
            titleRes = R.string.demo_reset_confirm_title,
            bodyRes = R.string.demo_reset_confirm_body,
            confirmRes = R.string.demo_reset_confirm,
            onCancel = { resetStep = ResetStep.NONE },
            onConfirm = {
                resetStep = ResetStep.NONE
                onConfirmedReset()
            },
        )
    }
}

@Composable
private fun ResetDialog(
    @StringRes titleRes: Int,
    @StringRes bodyRes: Int,
    @StringRes confirmRes: Int,
    onCancel: () -> Unit,
    onConfirm: () -> Unit,
) {
    // Back, a tap outside and Cancel all cancel. Nothing changes until the second confirmation.
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(stringResource(titleRes), modifier = Modifier.semantics { heading() }) },
        text = { Text(stringResource(bodyRes)) },
        dismissButton = {
            TextButton(onClick = onCancel, modifier = Modifier.heightIn(min = MinTouchTarget)) {
                Text(stringResource(R.string.demo_cancel))
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm, modifier = Modifier.heightIn(min = MinTouchTarget)) {
                Text(stringResource(confirmRes))
            }
        },
    )
}

@Composable
private fun StatusScreen(@StringRes textRes: Int) {
    Surface(Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(24.dp),
        ) {
            Text(
                text = stringResource(R.string.demo_banner),
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                text = stringResource(textRes),
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier
                    .padding(top = 16.dp)
                    .semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
    }
}

@Composable
private fun LockedScreen(screen: DemoScreen.Locked, onRetry: () -> Unit, onResetRequest: () -> Unit) {
    Surface(Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(text = stringResource(R.string.demo_banner), style = MaterialTheme.typography.titleMedium)
            Text(
                text = stringResource(R.string.demo_locked_title),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.semantics { heading() },
            )
            Text(text = stringResource(R.string.demo_locked_body), style = MaterialTheme.typography.bodyLarge)
            Text(
                text = stringResource(R.string.demo_locked_code, screen.reason.name),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            screen.notice?.let { NoticeText(it) }
            Button(onClick = onRetry, modifier = Modifier.fillMaxWidth().heightIn(min = MinTouchTarget)) {
                Text(stringResource(R.string.demo_try_again))
            }
            if (screen.canReset) {
                OutlinedButton(onClick = onResetRequest, modifier = Modifier.fillMaxWidth().heightIn(min = MinTouchTarget)) {
                    Text(stringResource(R.string.demo_reset_action))
                }
            } else {
                Text(text = stringResource(R.string.demo_locked_no_reset), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun SaveFailedNotice(onReload: () -> Unit) {
    Column(Modifier.padding(top = 8.dp)) {
        Text(
            text = stringResource(R.string.demo_save_failed),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        Button(onClick = onReload, modifier = Modifier.heightIn(min = MinTouchTarget)) {
            Text(stringResource(R.string.demo_reload))
        }
    }
}

@Composable
private fun NoticeText(notice: DemoNotice) {
    val res = when (notice) {
        DemoNotice.RESET_DONE -> R.string.demo_notice_reset_done
        DemoNotice.RESET_FAILED -> R.string.demo_notice_reset_failed
        DemoNotice.RESET_INCOMPLETE -> R.string.demo_notice_reset_incomplete
    }
    Text(
        text = stringResource(res),
        style = MaterialTheme.typography.bodyLarge,
        color = if (notice == DemoNotice.RESET_DONE) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error,
        modifier = Modifier
            .padding(top = 8.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
    )
}
