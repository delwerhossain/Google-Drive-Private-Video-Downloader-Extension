// Chrome rejects a whole download ("Invalid filename") when the name breaks its rules, see
// IsSafePortablePathComponent in chromium/src/net/base/filename_util_icu.cc.
// Video titles often break them (e.g. "LIVE 6: ..." or "2026/09/25"), so titles are cleaned first.

const EXTENSION_BY_MIME_TYPE = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/3gpp": "3gp",
    "video/x-matroska": "mkv"
};
const VIDEO_EXTENSION = /\.(mp4|m4v|mov|qt|mkv|webm|avi|wmv|flv|3gp|3g2|mpe?g|mts|m2ts|ogv)$/i;
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|clock\$)$/i;
// macOS allows 255 bytes per file name; leave room for the extension and ".crdownload".
const MAX_NAME_BYTES = 200;

function buildDownloadFilename(title, mimeType) {
    const mime = (mimeType || "").split(";")[0].trim().toLowerCase();
    const extension = EXTENSION_BY_MIME_TYPE[mime] || "mp4";

    let name = String(title || "").toWellFormed()
        .replace(/\p{Cc}/gu, " ")                                   // tabs, new lines
        .replace(/[\p{Cf}\p{Noncharacter_Code_Point}]/gu, "")        // invisible characters, e.g. zero-width joiner in Bangla
        .replace(/["*/:<>?\\|]/g, "-")
        .replace(/\p{White_Space}+/gu, " ");
    name = trimEnds(name).replace(VIDEO_EXTENSION, "");
    name = trimEnds(truncateUtf8(name, MAX_NAME_BYTES));

    if (!name) name = "Google Drive video";
    if (WINDOWS_DEVICE_NAME.test(name.split(".")[0])) name = "_" + name;
    return `${name}.${extension}`;
}

// A name may not start or end with whitespace, "." or "~".
function trimEnds(text) {
    return text.replace(/^[\p{White_Space}.~]+|[\p{White_Space}.~]+$/gu, "");
}

// Cuts on whole characters (graphemes), so Bangla letters and emoji are never split.
function truncateUtf8(text, maxBytes) {
    const encoder = new TextEncoder();
    if (encoder.encode(text).length <= maxBytes) return text;
    let result = "";
    let bytes = 0;
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
        bytes += encoder.encode(segment).length;
        if (bytes > maxBytes) break;
        result += segment;
    }
    return result;
}
