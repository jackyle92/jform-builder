/**
 * Signature fields. The renderer sends each signature as a PNG data URL with the answers:
 *   extract()      checks the image and puts its file name in the answer's place before anything reads the answers
 *   store()        saves the images as Files linked to the response, in the submission's transaction
 *   linkToRecord() also links them to the record the form created or updated (config.attachToRecord, on unless false)
 * The image itself never reaches Submission_Field_Value__c or a record field.
 */
public inherited sharing class JFormSignatureService {

    public static final String FIELD_TYPE = 'signature';
    public static final String DATA_URL_PREFIX = 'data:image/png;base64,';
    /** Largest image accepted, in bytes. A drawn signature is usually 5 to 30 KB. */
    @TestVisible private static Integer maxBytes = 300 * 1024;
    public static final Integer MAX_WIDTH = 3000;
    public static final Integer MAX_HEIGHT = 1500;
    /** The PNG signature followed by the length and type of the IHDR chunk, which holds the image size. */
    private static final String PNG_HEAD_HEX = '89504e470d0a1a0a0000000d49484452';
    private static final String BASE64_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    /** First line of a signature file's description; the next lines name the field and the image's SHA-256. */
    private static final String DESCRIPTION_HEADER = 'JForm signature';
    private static final String FIELD_LINE = 'Field: ';

    public class Signature {
        public String fieldKey;
        public String fileName;
        public Blob image;
    }

    public class Extracted {
        public List<Signature> signatures = new List<Signature>();
        /** Labels of signature fields whose answer is not a usable PNG. */
        public List<String> problems = new List<String>();
    }

    /**
     * Replace each signature answer with the file name it is stored under. An answer that is not a PNG
     * within the size limits is removed and its field's label returned as a problem, so it is never stored as text.
     */
    public static Extracted extract(JFormDefinition.Form def, Map<String, Object> answers) {
        Extracted out = new Extracted();
        if (def == null || def.sections == null || answers == null) {
            return out;
        }
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                if (f.fieldType != FIELD_TYPE || JFormSubmissionService.isEmpty(answers.get(f.key))) {
                    continue;
                }
                Blob image = decode(answers.get(f.key));
                if (image == null) {
                    answers.remove(f.key);
                    out.problems.add(String.isBlank(f.label) ? f.key : f.label);
                    continue;
                }
                Signature sig = new Signature();
                sig.fieldKey = f.key;
                sig.fileName = fileName(f);
                sig.image = image;
                answers.put(f.key, sig.fileName);
                out.signatures.add(sig);
            }
        }
        return out;
    }

    /** Save the images of the stored answers (fields left visible by logic) as Files linked to the response. */
    public static void store(Id submissionId, Extracted extracted, Set<String> storedKeys) {
        List<ContentVersion> versions = new List<ContentVersion>();
        for (Signature sig : extracted.signatures) {
            if (!storedKeys.contains(sig.fieldKey)) {
                continue;
            }
            versions.add(new ContentVersion(
                Title = sig.fileName,
                PathOnClient = sig.fileName,
                VersionData = sig.image,
                Description = description(sig),
                Origin = 'H',
                IsMajorVersion = true
            ));
        }
        if (versions.isEmpty()) {
            return;
        }
        insert versions;
        List<ContentDocumentLink> links = new List<ContentDocumentLink>();
        for (ContentVersion cv : [SELECT ContentDocumentId FROM ContentVersion WHERE Id IN :versions]) {
            links.add(new ContentDocumentLink(ContentDocumentId = cv.ContentDocumentId, LinkedEntityId = submissionId, ShareType = 'V', Visibility = 'AllUsers'));
        }
        insert links;
    }

    /**
     * Link the response's signature files to the record the form created or updated, for fields that
     * allow it. The response is already saved, so a link that fails (an object without Files) is only logged.
     */
    public static void linkToRecord(JFormDefinition.Form def, Id submissionId, Id recordId) {
        if (def == null || def.sections == null || submissionId == null || recordId == null) {
            return;
        }
        Set<String> keys = new Set<String>();
        for (JFormDefinition.Section s : def.sections) {
            for (JFormDefinition.Field f : s.fields) {
                Object attach = f.config == null ? null : f.config.get('attachToRecord');
                if (f.fieldType == FIELD_TYPE && String.valueOf(attach) != 'false') {
                    keys.add(f.key);
                }
            }
        }
        if (keys.isEmpty()) {
            return;
        }
        try {
            Map<Id, String> signatureFiles = signatureFilesOn(submissionId);
            if (signatureFiles.isEmpty()) {
                return;
            }
            Set<Id> documentIds = signatureFiles.keySet();
            Set<Id> linked = new Set<Id>();
            for (ContentDocumentLink l : [SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = :recordId AND ContentDocumentId IN :documentIds]) {
                linked.add(l.ContentDocumentId);
            }
            List<ContentDocumentLink> links = new List<ContentDocumentLink>();
            for (Id documentId : documentIds) {
                if (keys.contains(signatureFiles.get(documentId)) && !linked.contains(documentId)) {
                    // inferred sharing: whoever can see the record can see its signature
                    links.add(new ContentDocumentLink(ContentDocumentId = documentId, LinkedEntityId = recordId, ShareType = 'I', Visibility = 'AllUsers'));
                }
            }
            for (Database.SaveResult sr : Database.insert(links, false)) {
                if (!sr.isSuccess()) {
                    System.debug(LoggingLevel.WARN, 'JForm signature link to ' + recordId + ' failed: ' + sr.getErrors());
                }
            }
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'JForm signature link to ' + recordId + ' failed: ' + e.getMessage());
        }
    }

    /** How many signature images a response holds, so they do not count toward its file upload limit. */
    public static Integer countOn(Id submissionId) {
        return signatureFilesOn(submissionId).size();
    }

    // ------------------------------------------------------------ helpers

    /** The PNG in a data URL, or null when it is not a PNG within the size and dimension limits. */
    @TestVisible
    private static Blob decode(Object answer) {
        if (!(answer instanceof String)) {
            return null;
        }
        String text = (String) answer;
        if (!text.startsWith(DATA_URL_PREFIX)) {
            return null;
        }
        String base64 = text.substring(DATA_URL_PREFIX.length());
        // every 4 base64 characters carry 3 bytes
        if (base64.length() < 64 || Math.mod(base64.length(), 4) != 0 || base64.length() / 4 * 3 > maxBytes + 2
            || !base64.containsOnly(BASE64_CHARACTERS)) {
            return null;
        }
        // the first 24 bytes: PNG signature, IHDR length and type, width, height
        String head = EncodingUtil.convertToHex(EncodingUtil.base64Decode(base64.left(32)));
        if (!head.startsWith(PNG_HEAD_HEX) || head.length() < 48) {
            return null;
        }
        Long width = hexToLong(head.substring(32, 40));
        Long height = hexToLong(head.substring(40, 48));
        if (width < 1 || height < 1 || width > MAX_WIDTH || height > MAX_HEIGHT) {
            return null;
        }
        Blob image = EncodingUtil.base64Decode(base64);
        return image.size() > 0 && image.size() <= maxBytes ? image : null;
    }

    /** The field's label as a file name, such as "Parent signature.png". A slash in the label is not a folder, so the whole label is kept. */
    @TestVisible
    private static String fileName(JFormDefinition.Field f) {
        String label = String.isBlank(f.label) ? 'Signature' : f.label.normalizeSpace().replaceAll('[\\\\/]', '_');
        String safe = JFormUploadPolicy.safeFileName(label + '.png');
        return safe == null ? 'Signature.png' : safe;
    }

    /** Names the field, so the file can be found again, and the image's SHA-256, so a changed image can be detected. */
    private static String description(Signature sig) {
        String digest = EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', sig.image));
        return (DESCRIPTION_HEADER + '\n' + FIELD_LINE + sig.fieldKey + '\nSHA-256: ' + digest).left(1000);
    }

    /** Signature files linked to a response: ContentDocumentId -> field key. */
    private static Map<Id, String> signatureFilesOn(Id submissionId) {
        Map<Id, String> out = new Map<Id, String>();
        if (submissionId == null) {
            return out;
        }
        Set<Id> documentIds = new Set<Id>();
        for (ContentDocumentLink l : [SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = :submissionId]) {
            documentIds.add(l.ContentDocumentId);
        }
        if (documentIds.isEmpty()) {
            return out;
        }
        // Description cannot be filtered in SOQL, so the header is checked here
        for (ContentVersion cv : [SELECT ContentDocumentId, Description FROM ContentVersion WHERE ContentDocumentId IN :documentIds AND IsLatest = true]) {
            String key = fieldKeyOf(cv.Description);
            if (key != null) {
                out.put(cv.ContentDocumentId, key);
            }
        }
        return out;
    }

    @TestVisible
    private static String fieldKeyOf(String description) {
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

    private static Long hexToLong(String hex) {
        Long n = 0;
        for (Integer i = 0; i < hex.length(); i++) {
            n = n * 16 + '0123456789abcdef'.indexOf(hex.substring(i, i + 1));
        }
        return n;
    }
}
