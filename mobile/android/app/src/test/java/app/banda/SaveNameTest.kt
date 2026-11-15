package app.banda

import org.junit.Assert.assertEquals
import org.junit.Test

/** The name a save sheet is offered: one segment, never empty. */
class SaveNameTest {
    @Test fun aPlainNameIsKept() {
        assertEquals("report.pdf", SaveName.of("report.pdf"))
        assertEquals("notes 2026.md", SaveName.of("  notes 2026.md "))
    }

    @Test fun separatorsAndControlCharactersCannotPickAFolder() {
        assertEquals("_.._etc_passwd", SaveName.of("/../etc/passwd"))
        assertEquals("a_b", SaveName.of("a\\b"))
        assertEquals("line_break.txt", SaveName.of("line\nbreak.txt"))
    }

    @Test fun anEmptyOrHiddenNameBecomesFile() {
        assertEquals("file", SaveName.of(null))
        assertEquals("file", SaveName.of(""))
        assertEquals("file", SaveName.of("   "))
        assertEquals("file", SaveName.of("..."))
        assertEquals("hidden", SaveName.of(".hidden"))
    }

    @Test fun aVeryLongNameIsCut() {
        assertEquals(255, SaveName.of("x".repeat(400)).length)
    }
}
