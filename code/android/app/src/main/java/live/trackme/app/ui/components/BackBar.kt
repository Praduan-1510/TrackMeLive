package live.trackme.app.ui.components

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import live.trackme.app.R
import live.trackme.design.TmlTheme

/**
 * The top bar of a pushed screen (prototype `.a-top`): a 48dp Back button under the status bar, named
 * for where it goes ([backLabel], e.g. "Home"), and optional trailing content.
 */
@Composable
fun BackBar(
    backLabel: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    Row(
        modifier
            .fillMaxWidth()
            .windowInsetsPadding(WindowInsets.statusBars)
            .heightIn(min = 64.dp)
            .padding(start = 4.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(
            onClick = onBack,
            colors = IconButtonDefaults.iconButtonColors(contentColor = TmlTheme.colors.ink),
            modifier = Modifier.size(48.dp),
        ) {
            Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = backLabel)
        }
        Spacer(Modifier.weight(1f))
        trailing()
    }
}
