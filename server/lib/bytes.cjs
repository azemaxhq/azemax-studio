/**
 * UTF-8 byte helpers.
 *
 * Size limits in this codebase are expressed in BYTES, but JavaScript string
 * lengths are UTF-16 code units. Slicing on `.slice(0, MAX_BYTES)` under-counts
 * multi-byte input (a 200 KB string can be 600 KB of UTF-8), so every cap must
 * be applied with these helpers.
 */

function byteLength(value) {
    return Buffer.byteLength(String(value ?? ''), 'utf8');
}

/**
 * Return `value` truncated to at most `maxBytes` of UTF-8 without splitting a
 * code point. Returns the original string when it already fits.
 */
function truncateUtf8(value, maxBytes) {
    const str = String(value ?? '');
    const limit = Math.max(0, Number(maxBytes) || 0);
    if (byteLength(str) <= limit) return str;

    // Binary search the largest prefix that fits. The prefix length is in
    // UTF-16 code units, so a surrogate pair is never split.
    let lo = 0;
    let hi = str.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (byteLength(str.slice(0, mid)) <= limit) lo = mid;
        else hi = mid - 1;
    }
    return str.slice(0, lo);
}

module.exports = { byteLength, truncateUtf8 };
