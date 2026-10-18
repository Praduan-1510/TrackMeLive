package live.trackme.app.ui.signup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import live.trackme.app.R
import live.trackme.app.domain.Country
import live.trackme.app.ui.AppType
import live.trackme.app.ui.components.tabular
import live.trackme.design.TmlAndroidRadius
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme

/**
 * Choose your country: a modal bottom sheet with a search field and every country by name, with its
 * calling code. The current one has a check, so the choice never rests on color. Picking one closes
 * the sheet; [filter] decides what matches a search (PhoneNumbers.filter).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CountryPickerSheet(
    countries: List<Country>,
    selectedRegion: String,
    filter: (List<Country>, String) -> List<Country>,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val c = TmlTheme.colors
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var query by rememberSaveable { mutableStateOf("") }
    val shown = remember(countries, query) { filter(countries, query) }
    // Open on the current country, not at the top of the list.
    val listState = rememberLazyListState(initialFirstVisibleItemIndex = countries.indexOfFirst { it.region == selectedRegion }.coerceAtLeast(0))
    // Sheets are surface in light and surface-raised in dark (design-system README › Android › Surfaces).
    val sheetColor = if (c.ground.luminance() < 0.5f) c.surfaceRaised else c.surface

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        shape = RoundedCornerShape(topStart = TmlAndroidRadius.Dialog, topEnd = TmlAndroidRadius.Dialog),
        containerColor = sheetColor,
        contentColor = c.ink,
        scrimColor = ScrimColor,
    ) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f).imePadding()) {
            Text(
                text = stringResource(R.string.signup_country_title),
                style = AppType.title,
                color = c.ink,
                modifier = Modifier.padding(horizontal = TmlSpacing.Space6).semantics { heading() },
            )
            TmlTextField(
                value = query,
                onValueChange = { query = it },
                label = stringResource(R.string.signup_country_search),
                leading = { Icon(painterResource(R.drawable.ic_search), contentDescription = null, tint = c.inkSecondary) },
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Search),
                modifier = Modifier.padding(start = TmlSpacing.Space4, end = TmlSpacing.Space4, top = TmlSpacing.Space4, bottom = TmlSpacing.Space2),
            )
            if (shown.isEmpty()) {
                Text(
                    text = stringResource(R.string.signup_country_none, query.trim()),
                    style = AppType.body,
                    color = c.inkSecondary,
                    modifier = Modifier.padding(horizontal = TmlSpacing.Space6, vertical = TmlSpacing.Space4),
                )
            }
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxWidth().weight(1f).selectableGroup(),
                contentPadding = PaddingValues(bottom = TmlSpacing.Space6),
            ) {
                items(shown, key = { it.region }) { country ->
                    CountryRow(country, selected = country.region == selectedRegion, onClick = { onSelect(country.region) })
                }
            }
        }
    }
}

@Composable
private fun CountryRow(country: Country, selected: Boolean, onClick: () -> Unit) {
    val c = TmlTheme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = TmlSpacing.Space6, vertical = TmlSpacing.Space2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space3),
    ) {
        Text(country.name, style = AppType.listItem, color = c.ink, modifier = Modifier.weight(1f))
        Text(
            stringResource(R.string.signup_calling_code, country.callingCode),
            style = AppType.listItem.tabular(),
            color = c.inkSecondary,
        )
        if (selected) {
            Icon(painterResource(R.drawable.ic_check), contentDescription = null, tint = c.ink, modifier = Modifier.size(24.dp))
        } else {
            Spacer(Modifier.width(24.dp))
        }
    }
}

/** 50% black: strong enough to set the sheet apart in both themes. */
private val ScrimColor = androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.5f)
