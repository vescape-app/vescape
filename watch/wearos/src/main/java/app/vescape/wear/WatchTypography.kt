package app.vescape.wear

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.wear.compose.foundation.CurvedTextStyle
import androidx.wear.compose.material.Typography

/**
 * App typography from the shared font assets. Keep symbols in the system font.
 * @parity /watch/watchos/WatchTypography.swift
 */
internal object WatchTypography {
    val uiFamily = FontFamily(
        Font(R.font.raleway_500, FontWeight.Medium),
        Font(R.font.raleway_600, FontWeight.SemiBold),
    )
    val monoFamily = FontFamily(
        Font(R.font.jetbrains_mono_500, FontWeight.Medium),
        Font(R.font.jetbrains_mono_600, FontWeight.SemiBold),
    )

    private val platform = Typography()
    val material = Typography(
        display1 = ui(platform.display1),
        display2 = ui(platform.display2),
        display3 = ui(platform.display3),
        title1 = ui(platform.title1),
        title2 = ui(platform.title2),
        title3 = ui(platform.title3),
        body1 = ui(platform.body1),
        body2 = ui(platform.body2),
        button = ui(platform.button),
        caption1 = ui(platform.caption1),
        caption2 = ui(platform.caption2),
        caption3 = ui(platform.caption3),
    )

    private fun ui(style: TextStyle): TextStyle = style.copy(
        fontFamily = uiFamily,
        fontWeight = if ((style.fontWeight ?: FontWeight.Normal).weight >= FontWeight.SemiBold.weight) {
            FontWeight.SemiBold
        } else {
            FontWeight.Medium
        },
        fontFeatureSettings = "lnum",
    )

    fun mono(style: TextStyle): TextStyle = style.copy(fontFamily = monoFamily)

    fun curvedUi(style: CurvedTextStyle): CurvedTextStyle =
        style.copy(fontFamily = uiFamily, fontWeight = FontWeight.Medium)

    fun curvedMono(style: CurvedTextStyle): CurvedTextStyle =
        style.copy(fontFamily = monoFamily, fontWeight = FontWeight.Medium)
}
