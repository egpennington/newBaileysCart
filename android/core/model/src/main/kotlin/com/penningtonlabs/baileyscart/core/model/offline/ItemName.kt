package com.penningtonlabs.baileyscart.core.model.offline

/**
 * Display name that passed the RATIFIED validation rules only. The user's spelling is kept
 * exactly (after trimming the ends).
 *
 * Implemented (sources):
 *  - Reject empty or whitespace-only names (PRD v1.0 §2.2; API v0.4 §6).
 *  - Reject line breaks and control characters (PRD v1.0 §2.2): Unicode Cc, plus U+2028 and
 *    U+2029.
 *  - Reject bidi embedding, override and isolate controls U+202A..U+202E and U+2066..U+2069,
 *    and unpaired surrogates (API v0.3 Rev 1 §5 items 1-2).
 *  - At most 100 Unicode code points (API v0.4 §6).
 *
 * NOT implemented (W-03 OPEN; see the implementation report):
 *  - Canonical comparison keys, case or accent folding, NFC, and duplicate detection. PL D-6a
 *    says `Cafe` and `Café` are the same item; that is documented only and needs the full
 *    algorithm before it can be coded.
 *  - Collapsing internal whitespace and the exact Unicode White_Space set. Only the ends are
 *    trimmed (Kotlin Char.isWhitespace). The code-point count is taken after trimming and
 *    BEFORE any internal collapse, which can only over-count, never under-count.
 *  - Default-ignorable and unassigned code points: allowed (for example ZWJ emoji sequences).
 */
@JvmInline
value class ItemName private constructor(val display: String) {
    override fun toString(): String = "ItemName(<${display.codePointCount(0, display.length)} code points>)"

    companion object {
        const val MAX_CODE_POINTS: Int = 100

        fun validate(raw: String): NameValidation {
            if (hasUnpairedSurrogate(raw)) return NameValidation.Invalid(NameProblem.UNPAIRED_SURROGATE)
            val trimmed = raw.trim()
            if (trimmed.isEmpty()) return NameValidation.Invalid(NameProblem.BLANK)
            var i = 0
            while (i < trimmed.length) {
                val cp = trimmed.codePointAt(i)
                when {
                    cp == 0x0A || cp == 0x0D || cp == 0x85 || cp == 0x2028 || cp == 0x2029 ->
                        return NameValidation.Invalid(NameProblem.LINE_BREAK)
                    Character.getType(cp) == Character.CONTROL.toInt() ->
                        return NameValidation.Invalid(NameProblem.CONTROL_CHARACTER)
                    cp in 0x202A..0x202E || cp in 0x2066..0x2069 ->
                        return NameValidation.Invalid(NameProblem.BIDI_CONTROL)
                }
                i += Character.charCount(cp)
            }
            if (trimmed.codePointCount(0, trimmed.length) > MAX_CODE_POINTS) {
                return NameValidation.Invalid(NameProblem.TOO_LONG)
            }
            return NameValidation.Valid(ItemName(trimmed))
        }

        private fun hasUnpairedSurrogate(s: String): Boolean {
            var i = 0
            while (i < s.length) {
                val c = s[i]
                if (Character.isHighSurrogate(c)) {
                    if (i + 1 >= s.length || !Character.isLowSurrogate(s[i + 1])) return true
                    i += 2
                    continue
                }
                if (Character.isLowSurrogate(c)) return true
                i++
            }
            return false
        }
    }
}

enum class NameProblem { BLANK, LINE_BREAK, CONTROL_CHARACTER, BIDI_CONTROL, UNPAIRED_SURROGATE, TOO_LONG }

sealed interface NameValidation {
    data class Valid(val name: ItemName) : NameValidation
    data class Invalid(val problem: NameProblem) : NameValidation
}
