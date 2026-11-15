package app.banda

/**
 * The name a saved file is offered under in the system's save sheet: the app's own name for it, kept to one path
 * segment. A separator or a control character would let a name pick a folder, and the sheet refuses an empty one, so
 * both become `file`. The owner may still rename it in the sheet.
 */
internal object SaveName {
    private const val FALLBACK = "file"
    private const val MAX = 255

    fun of(name: String?): String {
        val cleaned = (name ?: "")
            .replace(Regex("[/\\\\\u0000-\u001f\u007f]"), "_")
            .trim()
            .trimStart('.')
        if (cleaned.isEmpty()) return FALLBACK
        return if (cleaned.length > MAX) cleaned.take(MAX) else cleaned
    }
}
