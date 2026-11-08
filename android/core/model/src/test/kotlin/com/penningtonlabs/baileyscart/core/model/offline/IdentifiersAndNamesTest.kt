package com.penningtonlabs.baileyscart.core.model.offline

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Identifiers, scope keys and ratified name validation (no canonicalization). */
class IdentifiersAndNamesTest {
    @Test fun itemIdAcceptsOnlyCanonicalLowercaseUuidV4() {
        assertNotNull(ItemId.parse("3f2b8c1e-9a4d-4c7e-8b2a-1d0e5f6a7b8c"))
        assertNull(ItemId.parse("3F2B8C1E-9A4D-4C7E-8B2A-1D0E5F6A7B8C")) // uppercase is not canonical
        assertNull(ItemId.parse("3f2b8c1e-9a4d-1c7e-8b2a-1d0e5f6a7b8c")) // version 1
        assertNull(ItemId.parse("3f2b8c1e-9a4d-4c7e-cb2a-1d0e5f6a7b8c")) // wrong variant
        assertNull(ItemId.parse("Milk"))
        assertNull(ItemId.parse(""))
        assertNotNull(ItemId.parse(ItemId.random().value))
        assertNotEquals(ItemId.random(), ItemId.random())
    }

    @Test fun opIdIsUuidV4AndStable() {
        val raw = Fx.uuid(77)
        assertEquals(OpId.parse(raw), OpId.parse(raw))
        assertNull(OpId.parse("not-an-op"))
    }

    @Test fun accountKeyNeverPrintsItsValue() {
        val key = AccountKey.of("fictional-account-value")!!
        assertFalse(key.toString().contains("fictional-account-value"))
        assertFalse(Fx.A1.toString().contains("test-account-a"))
        assertNull(AccountKey.of(" "))
        assertNull(AccountKey.of("has space"))
    }

    @Test fun familyScopesDistinguishAccountsAndFamilies() {
        assertNotEquals(Fx.A1, Fx.A2)
        assertNotEquals(Fx.A1, Fx.B1) // same family id under another account is a different scope
        assertNull(FamilyEpoch.of(0))
        assertTrue(Fx.E2 > Fx.E1)
    }

    @Test fun categoriesAreTheSixInFixedOrder() {
        assertEquals(listOf("PRODUCE", "DAIRY", "DRY", "FROZEN", "MISC", "MEAT"), Category.entries.map { it.name })
    }

    private fun problem(raw: String): NameProblem? = (ItemName.validate(raw) as? NameValidation.Invalid)?.problem

    @Test fun blankAndWhitespaceOnlyRejected() {
        assertEquals(NameProblem.BLANK, problem(""))
        assertEquals(NameProblem.BLANK, problem("   "))
        assertEquals(NameProblem.BLANK, problem("\t  "))
    }

    @Test fun lineBreaksAndControlsRejected() {
        assertEquals(NameProblem.LINE_BREAK, problem("Milk\nEggs"))
        assertEquals(NameProblem.LINE_BREAK, problem("Milk\rEggs"))
        assertEquals(NameProblem.LINE_BREAK, problem("Milk Eggs"))
        assertEquals(NameProblem.LINE_BREAK, problem("Milk Eggs"))
        assertEquals(NameProblem.LINE_BREAK, problem("Milk\u0085Eggs"))
        assertEquals(NameProblem.CONTROL_CHARACTER, problem("Mi\u0000lk"))
        assertEquals(NameProblem.CONTROL_CHARACTER, problem("Mi\u0007lk"))
        assertEquals(NameProblem.CONTROL_CHARACTER, problem("Mi\u007Flk"))
        assertEquals(NameProblem.CONTROL_CHARACTER, problem("Mi\tlk")) // tab is Cc inside a name
    }

    @Test fun bidiControlsAndUnpairedSurrogatesRejected() {
        assertEquals(NameProblem.BIDI_CONTROL, problem("Milk‮"))
        assertEquals(NameProblem.BIDI_CONTROL, problem("⁦Milk"))
        assertEquals(NameProblem.UNPAIRED_SURROGATE, problem("Milk\uD83C"))
        assertEquals(NameProblem.UNPAIRED_SURROGATE, problem("\uDF4EMilk"))
    }

    @Test fun limitIsOneHundredCodePointsIncludingSupplementary() {
        assertTrue(ItemName.validate("a".repeat(100)) is NameValidation.Valid)
        assertEquals(NameProblem.TOO_LONG, problem("a".repeat(101)))
        val apple = "🍎" // one code point, two UTF-16 units
        assertTrue(ItemName.validate(apple.repeat(100)) is NameValidation.Valid)
        assertEquals(NameProblem.TOO_LONG, problem(apple.repeat(101)))
        // Trimmed ends do not count toward the limit.
        assertTrue(ItemName.validate("  " + "a".repeat(100) + "  ") is NameValidation.Valid)
    }

    @Test fun displaySpellingPreservedWithoutCanonicalization() {
        fun display(raw: String) = (ItemName.validate(raw) as NameValidation.Valid).name.display
        assertEquals("Café", display("  Café "))
        assertEquals("Cafe", display("Cafe"))
        // W-03 OPEN: no case, accent or internal-whitespace folding is applied (PL D-6a is documented, not coded).
        assertNotEquals(display("Café"), display("Cafe"))
        assertEquals("Organic   Milk", display("Organic   Milk"))
        assertEquals("MILK", display("MILK"))
        // ZWJ emoji sequences are allowed (default-ignorable policy is open).
        assertEquals("👩‍🍳 cook", display("👩‍🍳 cook"))
    }
}
