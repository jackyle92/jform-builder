/**
 * The welcome and thank-you screens, kept in the form's settings as settings.welcome and
 * settings.ending (no fields of their own). problems() is checked on every save; welcomeView() and
 * endingView() are the cleaned parts the public form receives, because settings stay private.
 *
 * settings.welcome: mode (off | message | screen; without one, "message" when the form has a welcome
 * message, else "off"), title, buttonLabel, showTime, minutes, imageUrl, showHeader (form pages repeat the
 * title and description after a start screen).
 * settings.ending: title, buttons [{label, url}] (at most 2), submitAnother, redirectUrl, redirectDelay
 * (seconds before the redirect, 0 to 30).
 * settings.access.notOpen and settings.access.closed: the screens a form shows instead of its questions
 * before it opens and after it closes (JFormAvailability decides which): title, message (rich text),
 * imageUrl. The closed screen falls back to the older plain-text settings.access.closedMessage.
 */
public with sharing class JFormScreens {
    public static final Set<String> WELCOME_MODES = new Set<String>{ 'off', 'message', 'screen' };
    public static final Integer TITLE_MAX = 120;
    public static final Integer LABEL_MAX = 40;
    public static final Integer URL_MAX = 1000;
    public static final Integer MAX_BUTTONS = 2;
    public static final Integer MAX_DELAY = 30;
    public static final Integer MAX_MINUTES = 120;
    public static final Integer MESSAGE_MAX = 10000;
    private static final String NBSP = String.fromCharArray(new List<Integer>{ 160 });

    /** Links people follow or are sent to: http or https only, no spaces or quotes. */
    private static final Pattern LINK = Pattern.compile('(?i)^https?://[^\\s"\'<>]+$');
    /** Images: https, or a path on the same site. */
    private static final Pattern IMAGE = Pattern.compile('(?i)^(https://[^\\s"\'<>]+|/(?!/)[^\\s"\'<>]*)$');

    /** What is wrong with the stored screen settings, one sentence each; empty when nothing is. */
    public static List<String> problems(JFormDefinition.Form def) {
        List<String> out = new List<String>();
        Map<String, Object> welcome = part(def.settings, 'welcome');
        if (welcome != null) {
            Object mode = welcome.get('mode');
            if (mode != null && !WELCOME_MODES.contains(String.valueOf(mode))) {
                out.add('The welcome screen must be off, a message above the form, or a start screen.');
            }
            String image = text(welcome.get('imageUrl'));
            if (String.isNotBlank(image) && image(image) == null) {
                out.add('The welcome image must be an https link or a path on your site.');
            }
            Object minutes = welcome.get('minutes');
            Integer m = whole(minutes);
            if (!blank(minutes) && (m == null || m < 1 || m > MAX_MINUTES)) {
                out.add('The time to complete must be between 1 and ' + MAX_MINUTES + ' minutes.');
            }
        }
        Map<String, Object> ending = part(def.settings, 'ending');
        if (ending != null) {
            List<Object> buttons = ending.get('buttons') instanceof List<Object> ? (List<Object>) ending.get('buttons') : new List<Object>();
            if (buttons.size() > MAX_BUTTONS) {
                out.add('The thank-you screen can have at most ' + MAX_BUTTONS + ' buttons.');
            }
            for (Object b : buttons) {
                Map<String, Object> button = b instanceof Map<String, Object> ? (Map<String, Object>) b : new Map<String, Object>();
                String label = text(button.get('label'));
                String url = text(button.get('url'));
                if (String.isBlank(label) || link(url) == null) {
                    out.add('Each thank-you button needs a label and a link starting with http:// or https://.');
                    break;
                }
            }
            String redirect = text(ending.get('redirectUrl'));
            if (String.isNotBlank(redirect) && link(redirect) == null) {
                out.add('The redirect link must start with http:// or https://.');
            }
            Object delay = ending.get('redirectDelay');
            Integer d = whole(delay);
            if (!blank(delay) && (d == null || d < 0 || d > MAX_DELAY)) {
                out.add('The redirect wait must be between 0 and ' + MAX_DELAY + ' seconds.');
            }
        }
        Map<String, Object> access = part(def.settings, 'access');
        Map<String, String> screenNames = new Map<String, String>{ JFormAvailability.NOT_OPEN => 'not-yet-open', JFormAvailability.CLOSED => 'closed' };
        for (String state : screenNames.keySet()) {
            Map<String, Object> screen = part(access, state);
            String image = screen == null ? '' : text(screen.get('imageUrl'));
            if (String.isNotBlank(image) && image(image) == null) {
                out.add('The ' + screenNames.get(state) + ' screen image must be an https link or a path on your site.');
            }
        }
        return out;
    }

    /** How the form opens, cleaned for the public form. Always returns a mode. */
    public static Map<String, Object> welcomeView(JFormDefinition.Form def) {
        Map<String, Object> welcome = part(def.settings, 'welcome');
        Map<String, Object> view = new Map<String, Object>{ 'mode' => modeOf(def) };
        if (welcome == null) {
            return view;
        }
        putText(view, 'title', welcome.get('title'), TITLE_MAX);
        putText(view, 'buttonLabel', welcome.get('buttonLabel'), LABEL_MAX);
        if (welcome.get('showTime') == true) {
            view.put('showTime', true);
            Integer m = whole(welcome.get('minutes'));
            if (m != null && m >= 1 && m <= MAX_MINUTES) {
                view.put('minutes', m);
            }
        }
        String image = image(text(welcome.get('imageUrl')));
        if (image != null) {
            view.put('imageUrl', image);
        }
        if (welcome.get('showHeader') == true) {
            view.put('showHeader', true);
        }
        return view;
    }

    /** The thank-you screen's extras, cleaned for the public form; null when there are none. */
    public static Map<String, Object> endingView(JFormDefinition.Form def) {
        Map<String, Object> ending = part(def.settings, 'ending');
        if (ending == null) {
            return null;
        }
        Map<String, Object> view = new Map<String, Object>();
        putText(view, 'title', ending.get('title'), TITLE_MAX);
        List<Object> buttons = new List<Object>();
        if (ending.get('buttons') instanceof List<Object>) {
            for (Object b : (List<Object>) ending.get('buttons')) {
                if (buttons.size() >= MAX_BUTTONS || !(b instanceof Map<String, Object>)) {
                    continue;
                }
                Map<String, Object> button = (Map<String, Object>) b;
                String label = text(button.get('label')).normalizeSpace().left(LABEL_MAX);
                String url = link(text(button.get('url')));
                if (String.isNotBlank(label) && url != null) {
                    buttons.add(new Map<String, Object>{ 'label' => label, 'url' => url });
                }
            }
        }
        if (!buttons.isEmpty()) {
            view.put('buttons', buttons);
        }
        if (ending.get('submitAnother') == true) {
            view.put('submitAnother', true);
        }
        String redirect = link(text(ending.get('redirectUrl')));
        if (redirect != null) {
            view.put('redirectUrl', redirect);
            Integer d = whole(ending.get('redirectDelay'));
            view.put('redirectDelay', d == null ? 0 : Math.max(0, Math.min(MAX_DELAY, d)));
        }
        return view.isEmpty() ? null : view;
    }

    /**
     * The not-yet-open or closed screen, cleaned for the public form: title, message (rich text, shown through
     * lightning-formatted-rich-text, which sanitizes it) and imageUrl, each only when set.
     */
    public static Map<String, Object> availabilityView(JFormDefinition.Form def, String state) {
        Map<String, Object> access = part(def.settings, 'access');
        Map<String, Object> screen = part(access, state);
        Map<String, Object> view = new Map<String, Object>();
        if (screen != null) {
            putText(view, 'title', screen.get('title'), TITLE_MAX);
            String message = text(screen.get('message'));
            // as jformScreens.hasContent: a message of only spaces (or &nbsp;) is no message
            if (String.isNotBlank(message.stripHtmlTags().replace('&nbsp;', ' ').replace(NBSP, ' ')) || message.containsIgnoreCase('<img')) {
                view.put('message', message.left(MESSAGE_MAX));
            }
            String image = image(text(screen.get('imageUrl')));
            if (image != null) {
                view.put('imageUrl', image);
            }
        }
        // the closed message from before the closed screen, plain text
        String older = access == null ? '' : text(access.get('closedMessage'));
        if (state == JFormAvailability.CLOSED && !view.containsKey('message') && String.isNotBlank(older)) {
            view.put('message', '<p>' + older.left(MESSAGE_MAX).escapeHtml4() + '</p>');
        }
        return view;
    }

    /** Two lines for the agent's outline: how the form opens and what follows a response. */
    public static List<String> describe(JFormDefinition.Form def) {
        Map<String, Object> welcome = welcomeView(def);
        String mode = (String) welcome.get('mode');
        String opens = 'page 1';
        if (mode == 'screen') {
            opens = 'a start screen' + (welcome.containsKey('title') ? ' "' + welcome.get('title') + '"' : '')
                + ' with a "' + (welcome.containsKey('buttonLabel') ? welcome.get('buttonLabel') : 'Start') + '" button'
                + (welcome.containsKey('showTime') ? ' and the time to complete' : '')
                + (welcome.containsKey('showHeader') ? '; form pages repeat the title' : '; form pages leave out the title');
        } else if (mode == 'message') {
            opens = 'the welcome message above page 1';
        }
        List<String> after = new List<String>{ 'the thank-you message' };
        Map<String, Object> ending = endingView(def);
        if (ending != null) {
            if (ending.containsKey('title')) {
                after[0] = 'a thank-you screen "' + ending.get('title') + '"';
            }
            for (Object b : ending.containsKey('buttons') ? (List<Object>) ending.get('buttons') : new List<Object>()) {
                Map<String, Object> button = (Map<String, Object>) b;
                after.add('button "' + button.get('label') + '" to ' + button.get('url'));
            }
            if (ending.containsKey('submitAnother')) {
                after.add('a Submit another response button');
            }
            if (ending.containsKey('redirectUrl')) {
                Integer delay = (Integer) ending.get('redirectDelay');
                after.add(delay == 0 ? 'then goes straight to ' + ending.get('redirectUrl') : 'then goes to ' + ending.get('redirectUrl') + ' after ' + delay + ' s');
            }
        }
        return new List<String>{ 'Opens with: ' + opens, 'After submitting: ' + String.join(after, '; ') };
    }

    /** off, message or screen: the stored choice, else "message" for a form that has a welcome message. */
    public static String modeOf(JFormDefinition.Form def) {
        Map<String, Object> welcome = part(def.settings, 'welcome');
        Object mode = welcome == null ? null : welcome.get('mode');
        if (mode != null && WELCOME_MODES.contains(String.valueOf(mode))) {
            return String.valueOf(mode);
        }
        return String.isNotBlank(def.welcomeMessage == null ? null : def.welcomeMessage.stripHtmlTags()) ? 'message' : 'off';
    }

    // ------------------------------------------------------------ helpers

    private static Map<String, Object> part(Map<String, Object> parent, String key) {
        return parent != null && parent.get(key) instanceof Map<String, Object> ? (Map<String, Object>) parent.get(key) : null;
    }

    private static Boolean blank(Object value) {
        return value == null || (value instanceof String && String.isBlank((String) value));
    }

    private static String text(Object value) {
        return value instanceof String ? ((String) value).trim() : '';
    }

    private static void putText(Map<String, Object> view, String key, Object value, Integer max) {
        String t = text(value).normalizeSpace();
        if (String.isNotBlank(t)) {
            view.put(key, t.left(max));
        }
    }

    @TestVisible
    private static String link(String url) {
        return String.isNotBlank(url) && url.length() <= URL_MAX && LINK.matcher(url).matches() ? url : null;
    }

    @TestVisible
    private static String image(String url) {
        return String.isNotBlank(url) && url.length() <= URL_MAX && IMAGE.matcher(url).matches() ? url : null;
    }

    /** A whole number from JSON (Integer, Long or Decimal) or a digit string; null otherwise. */
    @TestVisible
    private static Integer whole(Object value) {
        if (value instanceof Integer) {
            return (Integer) value;
        }
        if (value instanceof Long) {
            return ((Long) value).intValue();
        }
        if (value instanceof Decimal) {
            Decimal d = (Decimal) value;
            return d == d.round(System.RoundingMode.DOWN) && d.abs() < 100000 ? d.intValue() : null;
        }
        if (value instanceof String && ((String) value).trim().isNumeric()) {
            String s = ((String) value).trim();
            return s.length() < 6 ? Integer.valueOf(s) : null;
        }
        return null;
    }
}
