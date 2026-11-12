/**
 * Spam protection for public submissions. Signals add up to a score and at the
 * threshold the response is stored as Spam rather than processed:
 *
 *   honeypot filled            100   (decisive)
 *   reCAPTCHA score below min   60   reCAPTCHA token missing   50
 *   timing token too fast       50   expired or invalid        50   missing   40
 *   same answers again          60   blocked word              60
 *   over the per-minute limit   40   too many links            30
 *
 * Per-form settings live in settings.protection; org-level keys (reCAPTCHA site key
 * and secret, token signing key, minimum score) in the Protection_Settings__c custom
 * setting. Everything degrades softly: a missing key or an unreachable verifier never
 * blocks a respondent, and spam is kept for review.
 */
public inherited sharing class JFormProtectionService {

    public static final String RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
    public static final String RECAPTCHA_ACTION = 'jform_submit';
    private static final Long TOKEN_MAX_AGE_MS = 24L * 60 * 60 * 1000;
    private static final Pattern LINK = Pattern.compile('(?i)(https?://|www\\.)');

    @TestVisible private static Integer threshold = 50;
    /** Tests set this instead of writing the custom setting. */
    @TestVisible private static Protection_Settings__c configOverride;
    /** Host names of the org's active sites (lower case), loaded once per transaction; tests set it directly. */
    @TestVisible private static Set<String> siteHosts;

    public class Settings {
        public Boolean enabled = true;
        public Boolean captcha = false;
        public Integer minSeconds = 3;
        public Integer perMinute = 20;
        public Integer maxLinks = 3;
        public Integer duplicateMinutes = 10;
        public List<String> blockedWords = new List<String>();
    }

    /** What arrived with the answers, stripped from them before storage. */
    public class Context {
        public Boolean trusted = false;        // authenticated API caller: honeypot only
        public Boolean honeypotFilled = false;
        public String token;                   // timing token from startSubmission
        public String captchaToken;            // reCAPTCHA v3 token
    }

    public class Verdict {
        public Boolean spam = false;
        public Integer score = 0;
        public List<String> reasons = new List<String>();
        public Decimal captchaScore;
        public String answersHash;

        public String reason() {
            return reasons.isEmpty() ? null : String.join(reasons, '; ').left(255);
        }
        private void flag(Integer points, String why) {
            score += points;
            reasons.add(why);
        }
    }

    // ------------------------------------------------------------ settings

    public static Settings settingsOf(JFormDefinition.Form def) {
        Settings s = new Settings();
        if (def == null || def.settings == null || !(def.settings.get('protection') instanceof Map<String, Object>)) {
            return s;
        }
        Map<String, Object> raw = (Map<String, Object>) def.settings.get('protection');
        s.enabled = flag(raw.get('enabled'), true);
        s.captcha = flag(raw.get('captcha'), false);
        s.minSeconds = whole(raw.get('minSeconds'), 3, 0, 600);
        s.perMinute = whole(raw.get('perMinute'), 20, 0, 10000);
        s.maxLinks = whole(raw.get('maxLinks'), 3, 0, 100);
        s.duplicateMinutes = whole(raw.get('duplicateMinutes'), 10, 0, 1440);
        Object words = raw.get('blockedWords');
        List<String> candidates = new List<String>();
        if (words instanceof List<Object>) {
            for (Object o : (List<Object>) words) {
                candidates.add(String.valueOf(o));
            }
        } else if (words != null) {
            candidates.addAll(String.valueOf(words).split('[,\\n]'));
        }
        for (String w : candidates) {
            String t = w == null ? '' : w.trim().toLowerCase();
            if (t != '' && !s.blockedWords.contains(t)) {
                s.blockedWords.add(t);
            }
        }
        return s;
    }

    /** The part of the protection the renderer needs: whether to load reCAPTCHA and with which (public) site key. */
    public static Map<String, Object> publicView(JFormDefinition.Form def) {
        Settings s = settingsOf(def);
        Boolean captchaOn = s.enabled && s.captcha && captchaConfigured();
        Map<String, Object> m = new Map<String, Object>{ 'captcha' => captchaOn };
        if (captchaOn) {
            m.put('siteKey', config().Site_Key__c);
        }
        return m;
    }

    // ------------------------------------------------------------ evaluate

    public static Verdict evaluate(Form__c form, JFormDefinition.Form def, Map<String, Object> answers, Context ctx) {
        Verdict v = new Verdict();
        v.answersHash = answersHash(def, answers);
        if (ctx != null && ctx.honeypotFilled) {
            v.flag(100, 'honeypot filled');
            v.spam = true;
            return v;
        }
        if (ctx == null || ctx.trusted) {
            return v;
        }
        Settings s = settingsOf(def);
        if (!s.enabled) {
            return v;
        }
        String timing = verifyToken(ctx.token, form.Public_Key__c, s.minSeconds);
        if (timing == 'missing') {
            v.flag(40, 'no timing token');
        } else if (timing == 'too_fast') {
            v.flag(50, 'submitted in under ' + s.minSeconds + ' seconds');
        } else if (timing == 'expired') {
            v.flag(50, 'timing token expired');
        } else if (timing == 'invalid') {
            v.flag(50, 'timing token invalid');
        }
        if (s.perMinute > 0 && rateLimited(form.Id, s.perMinute)) {
            v.flag(40, 'more than ' + s.perMinute + ' responses in a minute');
        }
        // an order is never a duplicate: each checkout is paid on its own, so a second order with the same
        // answers is charged and recorded rather than set aside
        if (s.duplicateMinutes > 0 && v.answersHash != null && !JFormPaymentService.owes(def, answers) && duplicate(form.Id, v.answersHash, s.duplicateMinutes)) {
            v.flag(60, 'same answers within ' + s.duplicateMinutes + ' minutes');
        }
        for (String why : contentFlags(def, answers, s)) {
            v.flag(why.startsWith('blocked word') ? 60 : 30, why);
        }
        if (s.captcha && captchaConfigured()) {
            if (String.isBlank(ctx.captchaToken)) {
                v.flag(50, 'no reCAPTCHA token');
            } else {
                v.captchaScore = verifyRecaptcha(ctx.captchaToken);
                if (v.captchaScore == null) {
                    System.debug(LoggingLevel.WARN, 'JForm: reCAPTCHA could not be verified; response accepted without a score.');
                } else if (v.captchaScore < minScore()) {
                    v.flag(60, 'reCAPTCHA score ' + v.captchaScore);
                }
            }
        }
        v.spam = v.score >= threshold;
        return v;
    }

    // ------------------------------------------------------------ timing token

    /** A signed "the form was opened at" stamp; null when no signing key is configured. */
    public static String issueToken(String publicKey) {
        Blob key = signingKey();
        if (key == null || String.isBlank(publicKey)) {
            return null;
        }
        String payload = System.now().getTime() + '|' + publicKey + '|' + EncodingUtil.convertToHex(Crypto.generateAesKey(128)).left(16);
        Blob bytes = Blob.valueOf(payload);
        return EncodingUtil.base64Encode(bytes) + '.' + EncodingUtil.base64Encode(Crypto.generateMac('hmacSHA256', bytes, key));
    }

    /** ok | missing | too_fast | expired | invalid | unverifiable (no signing key, nothing can be checked) */
    public static String verifyToken(String token, String publicKey, Integer minSeconds) {
        Blob key = signingKey();
        if (key == null) {
            return 'unverifiable';
        }
        if (String.isBlank(token)) {
            return 'missing';
        }
        try {
            List<String> parts = token.split('\\.');
            if (parts.size() != 2) {
                return 'invalid';
            }
            Blob bytes = EncodingUtil.base64Decode(parts[0]);
            if (!Crypto.verifyHMac('hmacSHA256', bytes, key, EncodingUtil.base64Decode(parts[1]))) {
                return 'invalid';
            }
            List<String> fields = bytes.toString().split('\\|');
            if (fields.size() < 3 || fields[1] != publicKey) {
                return 'invalid';
            }
            Long age = System.now().getTime() - Long.valueOf(fields[0]);
            if (age < 0 || age > TOKEN_MAX_AGE_MS) {
                return 'expired';
            }
            if (age < minSeconds * 1000L) {
                return 'too_fast';
            }
            return 'ok';
        } catch (Exception e) {
            return 'invalid';
        }
    }

    // ------------------------------------------------------------ signals

    @TestVisible
    private static Boolean rateLimited(Id formId, Integer perMinute) {
        Datetime since = System.now().addMinutes(-1);
        return [SELECT COUNT() FROM Form_Submission__c WHERE Form__c = :formId AND Submission_Date_Time__c >= :since] >= perMinute;
    }

    @TestVisible
    private static Boolean duplicate(Id formId, String hash, Integer minutes) {
        Datetime since = System.now().addMinutes(-minutes);
        // an unpaid response does not count: a respondent who cancelled the checkout pays again with the same answers
        Set<String> unpaid = JFormPaymentService.UNPAID;
        return [
            SELECT COUNT() FROM Form_Submission__c
            WHERE Form__c = :formId AND Answers_Hash__c = :hash AND Submission_Date_Time__c >= :since AND Payment_Status__c NOT IN :unpaid
        ] > 0;
    }

    /** SHA-256 over the normalised answers to the form's fields, or null when nothing was answered. */
    public static String answersHash(JFormDefinition.Form def, Map<String, Object> answers) {
        if (def == null || answers == null || answers.isEmpty()) {
            return null;
        }
        Map<String, JFormDefinition.Field> fields = def.fieldsByKey();
        List<String> keys = new List<String>(answers.keySet());
        keys.sort();
        List<String> parts = new List<String>();
        for (String k : keys) {
            if (!fields.containsKey(k)) {
                continue;
            }
            String v = JFormSubmissionService.stringify(answers.get(k));
            if (String.isBlank(v)) {
                continue;
            }
            parts.add(k + '=' + v.trim().toLowerCase().replaceAll('\\s+', ' '));
        }
        return parts.isEmpty() ? null : EncodingUtil.convertToHex(Crypto.generateDigest('SHA-256', Blob.valueOf(String.join(parts, '\n'))));
    }

    /**
     * Links in free text beyond the limit, and blocked words anywhere. URL, email and file fields are expected to hold links;
     * a signature is a base64 image, whose + and / could make a blocked word match.
     */
    @TestVisible
    private static List<String> contentFlags(JFormDefinition.Form def, Map<String, Object> answers, Settings s) {
        List<String> flags = new List<String>();
        if (def == null || answers == null) {
            return flags;
        }
        Map<String, JFormDefinition.Field> fields = def.fieldsByKey();
        Integer links = 0;
        List<String> hits = new List<String>();
        for (String k : answers.keySet()) {
            JFormDefinition.Field f = fields.get(k);
            if (f == null || f.fieldType == 'url' || f.fieldType == 'email' || f.fieldType == 'fileupload' || f.fieldType == JFormSignatureService.FIELD_TYPE) {
                continue;
            }
            String text = JFormSubmissionService.stringify(answers.get(k));
            if (String.isBlank(text)) {
                continue;
            }
            Matcher m = LINK.matcher(text);
            while (m.find()) {
                links++;
            }
            for (String w : s.blockedWords) {
                if (!hits.contains(w) && Pattern.compile('(?i)(^|\\W)' + Pattern.quote(w) + '($|\\W)').matcher(text).find()) {
                    hits.add(w);
                }
            }
        }
        if (links > s.maxLinks) {
            flags.add(links + ' links in the answers');
        }
        if (!hits.isEmpty()) {
            flags.add('blocked word' + (hits.size() > 1 ? 's' : '') + ': ' + String.join(hits, ', '));
        }
        return flags;
    }

    // ------------------------------------------------------------ reCAPTCHA

    /** The reCAPTCHA v3 score for a token, or null when Google could not be asked or did not answer sensibly. */
    @TestVisible
    private static Decimal verifyRecaptcha(String token) {
        try {
            HttpRequest req = new HttpRequest();
            req.setEndpoint(RECAPTCHA_VERIFY_URL);
            req.setMethod('POST');
            req.setTimeout(10000);
            req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
            req.setBody('secret=' + EncodingUtil.urlEncode(config().Secret__c, 'UTF-8') + '&response=' + EncodingUtil.urlEncode(token, 'UTF-8'));
            HttpResponse res = new Http().send(req);
            if (res.getStatusCode() != 200) {
                return null;
            }
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
            if (body.get('success') != true) {
                return 0;
            }
            if (body.get('action') != null && String.valueOf(body.get('action')) != RECAPTCHA_ACTION) {
                return 0;
            }
            if (!isSiteHost(body.get('hostname'))) {
                return 0; // a token made on another site that uses the same key
            }
            return body.get('score') == null ? 0 : Decimal.valueOf(String.valueOf(body.get('score')));
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'JForm: reCAPTCHA verification failed: ' + e.getMessage());
            return null;
        }
    }

    /** Whether the page that made a token is one of the org's sites. Without a host to compare (none returned, no sites found) it cannot judge and allows it. */
    private static Boolean isSiteHost(Object hostname) {
        if (hostname == null || String.isBlank(String.valueOf(hostname))) {
            return true;
        }
        if (siteHosts == null) {
            siteHosts = JFormChannelService.siteHosts();
        }
        return siteHosts.isEmpty() || siteHosts.contains(String.valueOf(hostname).toLowerCase());
    }

    // ------------------------------------------------------------ config

    private static Protection_Settings__c config() {
        return configOverride != null ? configOverride : Protection_Settings__c.getOrgDefaults();
    }

    public static Boolean captchaConfigured() {
        Protection_Settings__c c = config();
        return c != null && String.isNotBlank(c.Site_Key__c) && String.isNotBlank(c.Secret__c);
    }

    public static Boolean signingConfigured() {
        return signingKey() != null;
    }

    private static Blob signingKey() {
        Protection_Settings__c c = config();
        if (c == null || String.isBlank(c.Signing_Key__c)) {
            return null;
        }
        try {
            return EncodingUtil.convertFromHex(c.Signing_Key__c);
        } catch (Exception e) {
            return Blob.valueOf(c.Signing_Key__c); // any text works as a key, hex is just the documented form
        }
    }

    private static Decimal minScore() {
        Protection_Settings__c c = config();
        return c == null || c.Min_Score__c == null ? 0.5 : c.Min_Score__c;
    }

    private static Boolean flag(Object o, Boolean fallback) {
        if (o instanceof Boolean) {
            return (Boolean) o;
        }
        if (o instanceof String) {
            return String.valueOf(o).toLowerCase() == 'true';
        }
        return fallback;
    }

    private static Integer whole(Object o, Integer fallback, Integer min, Integer max) {
        Integer n = fallback;
        try {
            if (o instanceof Integer) {
                n = (Integer) o;
            } else if (o instanceof Decimal) {
                n = ((Decimal) o).intValue();
            } else if (o != null && String.isNotBlank(String.valueOf(o))) {
                n = Integer.valueOf(String.valueOf(o));
            }
        } catch (Exception e) {
            n = fallback;
        }
        return Math.max(min, Math.min(max, n));
    }
}
