package com.penningtonlabs.baileyscart

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.penningtonlabs.baileyscart.core.model.BuildContract

/**
 * App host. Content comes from the build-type AppEntry: debug shows the BC-UI-S1 LOCAL DEMO,
 * and release shows the WP-00 placeholder.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                AppEntry.Content(owner = this)
            }
        }
    }
}

/** WP-00 placeholder. Release builds show this. Product UI arrives in later work packages. */
@Composable
internal fun PlaceholderContent() {
    Surface {
        Text(text = stringResource(R.string.wp00_placeholder) + " " + BuildContract.WORK_PACKAGE)
    }
}
