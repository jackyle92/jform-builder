/**
 * Which files a respondent may attach to a file upload field, and the name they are stored under.
 * The field's fileType (Image, Document, Audio; blank = any of them) picks an extension
 * allowlist, and the builder can narrow it further (config.extensions). Anything else is refused,
 * so web content (html, svg, js) and executables never reach Files. Also the field's limits on
 * size (config.maxSizeMb) and number (config.maxFiles). Mirrors allowedExtensions() and
 * fileLimits() in c/jformFieldRegistry, which set the file input's accept list and refuse a file when it's picked.
 */
public inherited sharing class JFormUploadPolicy {

    public static final Integer MAX_FILE_NAME_LENGTH = 255;
    /** The most Apex takes in one upload. */
    public static final Integer MAX_SIZE_MB = 3;
    /** The most files one field takes; a response takes ten in all (JFormPublicController). */
    public static final Integer MAX_FILES = 10;

    private static final Map<String, Set<String>> EXTENSIONS_BY_FILE_TYPE = new Map<String, Set<String>>{
        'image' => new Set<String>{ 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff' },
        'document' => new Set<String>{ 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'csv' },
        'audio' => new Set<String>{ 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac' }
    };
    /** Path separators, characters Windows and macOS refuse in names, and control characters. */
    private static final String UNSAFE_NAME_CHARACTERS = '[\\\\/:*?"<>|\\p{Cntrl}]';
    /** An uploaded file's Description names its field, as signature images do (JFormSignatureService). */
    private static final String DESCRIPTION_HEADER = 'JForm upload';
    private static final String FIELD_LINE = 'Field: ';

    /**
     * The extensions allowed for a field, lower case: the fileType's allowlist, narrowed to config.extensions when
     * the builder chose Only these. Never wider than the allowlist.
     */
    public static Set<String> allowedExtensions(JFormDefinition.Field field) {
        Set<String> allowed = groupExtensions(field);
        Set<String> chosen = chosenExtensions(field);
        if (chosen == null) {
            return allowed;
        }
        Set<String> narrowed = new Set<String>(allowed);
        narrowed.retainAll(chosen);
        return narrowed;
    }

    /** The field's largest file in MB: config.maxSizeMb from 1 to 3, else 3. */
    public static Integer maxSizeMb(JFormDefinition.Field field) {
        return limitOf(field, 'maxSizeMb', MAX_SIZE_MB);
    }

    /** How many files the field takes: config.maxFiles from 1 to 10, else 10. */
    public static Integer maxFiles(JFormDefinition.Field field) {
        return limitOf(field, 'maxFiles', MAX_FILES);
    }

    /** What is wrong with a file upload field's settings, for saving: unknown extensions, none ticked, limits out of range. */
    public static List<String> configProblems(JFormDefinition.Field field) {
        List<String> problems = new List<String>();
        if (field == null || field.fieldType != 'fileupload' || field.config == null) {
            return problems;
        }
        String name = '"' + (String.isBlank(field.label) ? field.key : field.label) + '"';
        Object raw = field.config.get('extensions');
        if (raw != null) {
            Set<String> chosen = chosenExtensions(field);
            if (chosen == null || chosen.isEmpty()) {
                problems.add('Field ' + name + ': tick at least one file type.');
            } else {
                Set<String> unknown = new Set<String>(chosen);
                unknown.removeAll(groupExtensions(field));
                if (!unknown.isEmpty()) {
                    List<String> sortedUnknown = new List<String>(unknown);
                    sortedUnknown.sort();
                    problems.add('Field ' + name + ' cannot take files of type ' + String.join(sortedUnknown, ', ') + '.');
                }
            }
        }
        // a limit left out is off; one that is set must be in range
        if (field.config.get('maxSizeMb') != null && wholeNumberBetween(field.config.get('maxSizeMb'), 1, MAX_SIZE_MB) == null) {
            problems.add('Field ' + name + ': the largest file must be 1 to ' + MAX_SIZE_MB + ' MB.');
        }
        if (field.config.get('maxFiles') != null && wholeNumberBetween(field.config.get('maxFiles'), 1, MAX_FILES) == null) {
            problems.add('Field ' + name + ': the number of files must be 1 to ' + MAX_FILES + '.');
        }
        return problems;
    }

    /**
     * The name to store: the last path segment only, unsafe characters replaced, whitespace collapsed,
     * at most 255 characters with the extension kept. Null when nothing usable is left.
     */
    public static String safeFileName(String fileName) {
        if (String.isBlank(fileName)) {
            return null;
        }
        // both / and \ separate folders; a name ending in one has no file name
        String forwardSlashed = fileName.replace('\\', '/');
        String lastSegment = forwardSlashed.contains('/') ? forwardSlashed.substringAfterLast('/') : forwardSlashed;
        String cleaned = lastSegment.replaceAll(UNSAFE_NAME_CHARACTERS, '_').normalizeSpace();
        // a leading dot would make a hidden file and could hide the extension
        while (cleaned.startsWith('.')) {
            cleaned = cleaned.substring(1);
        }
        if (String.isBlank(cleaned)) {
            return null;
        }
        if (cleaned.length() > MAX_FILE_NAME_LENGTH) {
            String extension = extensionOf(cleaned);
            String suffix = extension == null ? '' : '.' + extension;
            cleaned = cleaned.left(MAX_FILE_NAME_LENGTH - suffix.length()) + suffix;
        }
        return cleaned;
    }

    /** Why a file cannot be attached to the field, or null when it can. */
    public static String problemWith(JFormDefinition.Field field, String fileName) {
        String safeName = safeFileName(fileName);
        if (safeName == null) {
            return 'The file needs a name.';
        }
        String extension = extensionOf(safeName);
        Set<String> allowed = allowedExtensions(field);
        if (extension == null || !allowed.contains(extension)) {
            List<String> sortedAllowed = new List<String>(allowed);
            sortedAllowed.sort();
            return 'Files of this type cannot be attached. Allowed: ' + String.join(sortedAllowed, ', ') + '.';
        }
        return null;
    }

    /** The Description an uploaded file is stored with: it names the field the file was attached to. */
    public static String description(String fieldKey) {
        return (DESCRIPTION_HEADER + '\n' + FIELD_LINE + fieldKey).left(1000);
    }

    /** The field an uploaded file was attached to, from its Description; null for any other file. */
    public static String fieldKeyOf(String description) {
        if (description == null || !description.startsWith(DESCRIPTION_HEADER + '\n')) {
            return null;
        }
        for (String line : description.split('\n')) {
            if (line.startsWith(FIELD_LINE)) {
                return line.substring(FIELD_LINE.length()).trim();
            }
        }
        return null;
    }

    /** The fileType's allowlist, or every allowed extension when it is blank or unknown. */
    private static Set<String> groupExtensions(JFormDefinition.Field field) {
        String fileType = field == null || String.isBlank(field.fileType) ? null : field.fileType.toLowerCase();
        if (fileType != null && EXTENSIONS_BY_FILE_TYPE.containsKey(fileType)) {
            return EXTENSIONS_BY_FILE_TYPE.get(fileType);
        }
        Set<String> allTypes = new Set<String>();
        for (Set<String> extensions : EXTENSIONS_BY_FILE_TYPE.values()) {
            allTypes.addAll(extensions);
        }
        return allTypes;
    }

    /**
     * config.extensions, lower case without dots; null when the field takes any allowed file. Anything but a list
     * of text counts as an empty list, so a broken setting takes nothing rather than everything.
     */
    private static Set<String> chosenExtensions(JFormDefinition.Field field) {
        Object raw = field == null || field.config == null ? null : field.config.get('extensions');
        if (raw == null) {
            return null;
        }
        Set<String> chosen = new Set<String>();
        if (raw instanceof List<Object>) {
            for (Object item : (List<Object>) raw) {
                if (item instanceof String && String.isNotBlank((String) item)) {
                    chosen.add(((String) item).trim().removeStart('.').toLowerCase());
                }
            }
        }
        return chosen;
    }

    private static Integer limitOf(JFormDefinition.Field field, String key, Integer most) {
        Integer n = field == null || field.config == null ? null : wholeNumberBetween(field.config.get(key), 1, most);
        return n == null ? most : n;
    }

    /** The whole number from lowest to highest, or null for anything else. */
    private static Integer wholeNumberBetween(Object raw, Integer lowest, Integer highest) {
        Integer n = JFormFieldParts.intOf(raw);
        return n != null && n >= lowest && n <= highest ? n : null;
    }

    /** Lower-case extension without the dot, or null when the name has none. */
    private static String extensionOf(String fileName) {
        if (!fileName.contains('.')) {
            return null;
        }
        String extension = fileName.substringAfterLast('.').toLowerCase();
        return String.isBlank(extension) ? null : extension;
    }
}
