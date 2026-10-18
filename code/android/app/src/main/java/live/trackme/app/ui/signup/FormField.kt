package live.trackme.app.ui.signup

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import live.trackme.app.R
import live.trackme.app.ui.AppType
import live.trackme.design.TmlAndroidRadius
import live.trackme.design.TmlTheme

/**
 * An outlined text field in our tokens (prototype `.a-field`, `.a-vfield`): 4dp corners, a 1dp
 * ink-tertiary outline that turns 2dp lamplight while focused, and the label in lamplight-text then.
 *
 * Errors are neutral, never flare (design-system README › Errors): a 2dp ink outline and the message
 * under the field in ink with an error icon. The message is a polite live region, and the field
 * itself carries the error for TalkBack. Without an error, [helper] shows instead.
 */
@Composable
fun TmlTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    helper: String? = null,
    error: String? = null,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    placeholder: String? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    textStyle: TextStyle = AppType.body,
    onFocusChange: (Boolean) -> Unit = {},
) {
    val c = TmlTheme.colors
    val interaction = remember { MutableInteractionSource() }
    val colors = tmlTextFieldColors()
    val isError = error != null
    val selection = TextSelectionColors(handleColor = c.lamplightText, backgroundColor = c.lamplight.copy(alpha = 0.4f))
    CompositionLocalProvider(LocalTextSelectionColors provides selection) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .onFocusChanged { onFocusChange(it.isFocused) }
                .semantics { if (error != null) error(error) },
            textStyle = textStyle.copy(color = c.ink),
            cursorBrush = SolidColor(c.lamplightText),
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            singleLine = true,
            visualTransformation = visualTransformation,
            interactionSource = interaction,
            decorationBox = { inner ->
                OutlinedTextFieldDefaults.DecorationBox(
                    value = value,
                    innerTextField = inner,
                    enabled = true,
                    singleLine = true,
                    visualTransformation = visualTransformation,
                    interactionSource = interaction,
                    isError = isError,
                    label = { Text(label) },
                    leadingIcon = leading,
                    trailingIcon = trailing,
                    placeholder = placeholder?.let { { Text(it) } },
                    supportingText = when {
                        error != null -> { { FieldMessage(error, isError = true) } }
                        helper != null -> { { FieldMessage(helper, isError = false) } }
                        else -> null
                    },
                    colors = colors,
                    container = {
                        OutlinedTextFieldDefaults.Container(
                            enabled = true,
                            isError = isError,
                            interactionSource = interaction,
                            colors = colors,
                            shape = RoundedCornerShape(TmlAndroidRadius.Field),
                            focusedBorderThickness = 2.dp,
                            // An error keeps the 2dp outline even when the field isn't focused.
                            unfocusedBorderThickness = if (isError) 2.dp else 1.dp,
                        )
                    },
                )
            },
        )
    }
}

/** Helper text (ink-secondary) or an error (ink, with the error icon) under a field. */
@Composable
fun FieldMessage(text: String, isError: Boolean, modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    if (isError) {
        Row(
            modifier.semantics { liveRegion = LiveRegionMode.Polite },
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(painterResource(R.drawable.ic_error_filled), contentDescription = null, tint = c.ink, modifier = Modifier.size(18.dp))
            Text(text, style = ErrorStyle, color = c.ink)
        }
    } else {
        Text(text, style = HelperStyle, color = c.inkSecondary, modifier = modifier)
    }
}

/** Field errors: Figtree 600, 13/18 (prototype `.a-err`). */
val ErrorStyle: TextStyle
    @Composable get() = TextStyle(fontFamily = TmlTheme.type.text, fontWeight = FontWeight.W600, fontSize = 13.sp, lineHeight = 18.sp)

/** Helper text: Figtree 400, 12/16 (prototype `.a-help`). */
val HelperStyle: TextStyle
    @Composable get() = TextStyle(fontFamily = TmlTheme.type.text, fontWeight = FontWeight.W400, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.3.sp)

@Composable
private fun tmlTextFieldColors(): TextFieldColors {
    val c = TmlTheme.colors
    return OutlinedTextFieldDefaults.colors(
        focusedTextColor = c.ink,
        unfocusedTextColor = c.ink,
        errorTextColor = c.ink,
        focusedContainerColor = Color.Transparent,
        unfocusedContainerColor = Color.Transparent,
        errorContainerColor = Color.Transparent,
        cursorColor = c.lamplightText,
        errorCursorColor = c.lamplightText,
        focusedBorderColor = c.lamplight,
        unfocusedBorderColor = c.inkTertiary,
        errorBorderColor = c.ink,
        focusedLabelColor = c.lamplightText,
        unfocusedLabelColor = c.inkSecondary,
        errorLabelColor = c.ink,
        focusedLeadingIconColor = c.ink,
        unfocusedLeadingIconColor = c.ink,
        errorLeadingIconColor = c.ink,
        focusedTrailingIconColor = c.inkSecondary,
        unfocusedTrailingIconColor = c.inkSecondary,
        errorTrailingIconColor = c.inkSecondary,
        focusedPlaceholderColor = c.inkSecondary,
        unfocusedPlaceholderColor = c.inkSecondary,
        focusedSupportingTextColor = c.inkSecondary,
        unfocusedSupportingTextColor = c.inkSecondary,
        errorSupportingTextColor = c.ink,
    )
}
