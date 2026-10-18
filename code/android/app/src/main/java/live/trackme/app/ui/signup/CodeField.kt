package live.trackme.app.ui.signup

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.stringResource
import kotlinx.coroutines.delay
import live.trackme.app.R
import live.trackme.app.ui.components.rememberReduceMotion
import live.trackme.design.TmlAndroidRadius
import live.trackme.design.TmlTheme

/**
 * The 6-digit code as six boxes (prototype `.a-otp`): one text field underneath, so typing, pasting,
 * the keyboard's suggestion from Messages and autofill all work, and TalkBack reads one "6-digit code"
 * field with how many digits are in. The next box to fill has a 2dp lamplight outline and a caret;
 * after a wrong or expired code all six take a 2dp ink-tertiary outline. Digits are Gabarito in
 * tabular figures, and each one pops in as it's typed (still with Remove animations on).
 */
@Composable
fun CodeField(
    code: String,
    onCodeChange: (String) -> Unit,
    length: Int,
    isError: Boolean,
    /** While the code is being checked: no edits, but the field keeps focus (and the keyboard stays up). */
    readOnly: Boolean,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
    errorMessage: String? = null,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val label = stringResource(R.string.code_field)
    val progress = stringResource(R.string.code_progress, code.length)
    // The real text field is invisible, so are its cursor, handles and selection: the boxes draw all that.
    CompositionLocalProvider(LocalTextSelectionColors provides NoSelection) {
    BasicTextField(
        value = code,
        onValueChange = onCodeChange,
        readOnly = readOnly,
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        interactionSource = interaction,
        cursorBrush = SolidColor(Color.Transparent),
        modifier = modifier
            .widthIn(max = 420.dp)
            .fillMaxWidth()
            .semantics {
                contentDescription = label
                stateDescription = progress
                contentType = ContentType.SmsOtpCode
                if (errorMessage != null) error(errorMessage)
            },
        decorationBox = { inner ->
            Box {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    repeat(length) { i ->
                        CodeCell(
                            digit = code.getOrNull(i),
                            current = focused && !readOnly && i == code.length,
                            isError = isError,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
                // The real text stays invisible over the boxes: it keeps the cursor logic, long-press Paste
                // and the IME connection, while the boxes draw what was typed.
                Box(Modifier.matchParentSize().alpha(0f)) { inner() }
            }
        },
    )
    }
}

private val NoSelection = TextSelectionColors(handleColor = Color.Transparent, backgroundColor = Color.Transparent)

@Composable
private fun CodeCell(digit: Char?, current: Boolean, isError: Boolean, modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    val shape = RoundedCornerShape(TmlAndroidRadius.Field)
    val (width, color) = when {
        isError -> 2.dp to c.inkTertiary
        current -> 2.dp to c.lamplight
        else -> 1.dp to c.inkTertiary
    }
    Box(
        modifier.height(56.dp).border(width, color, shape),
        contentAlignment = Alignment.Center,
    ) {
        if (digit != null) {
            PoppingDigit(digit)
        } else if (current) {
            Caret()
        }
    }
}

@Composable
private fun PoppingDigit(digit: Char) {
    val reduceMotion = rememberReduceMotion()
    val scale = remember(digit) { Animatable(if (reduceMotion) 1f else 0.6f) }
    LaunchedEffect(digit) {
        if (!reduceMotion) scale.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow))
    }
    Text(
        text = digit.toString(),
        style = DigitStyle,
        color = TmlTheme.colors.ink,
        modifier = Modifier.graphicsLayer {
            scaleX = scale.value
            scaleY = scale.value
        },
    )
}

/** A 2dp lamplight-text caret that blinks once a second; steady with Remove animations on. */
@Composable
private fun Caret(height: Dp = 26.dp) {
    val color = TmlTheme.colors.lamplightText
    val reduceMotion = rememberReduceMotion()
    val visible = remember { Animatable(1f) }
    LaunchedEffect(reduceMotion) {
        if (reduceMotion) return@LaunchedEffect
        while (true) {
            delay(500)
            visible.animateTo(0f, tween(0))
            delay(500)
            visible.animateTo(1f, tween(0))
        }
    }
    Box(
        Modifier
            .size(width = 2.dp, height = height)
            .drawBehind {
                drawRoundRect(
                    color = color.copy(alpha = color.alpha * visible.value),
                    topLeft = Offset.Zero,
                    size = Size(size.width, size.height),
                    cornerRadius = CornerRadius(1.dp.toPx()),
                )
            },
    )
}

private val DigitStyle: TextStyle
    @Composable get() = TextStyle(
        fontFamily = TmlTheme.type.display,
        fontWeight = FontWeight.W700,
        fontSize = 26.sp,
        fontFeatureSettings = "tnum",
        color = Color.Unspecified,
    )
