/**
 * When a form takes responses, from settings.access: openAt and closeAt (ISO 8601 moments, stored in UTC),
 * timeZone (the IANA zone the builder enters them in and respondents read them in), and closeDate, the
 * older day-only closing that is still checked as before, in the site guest user's time zone, while closeAt
 * is empty. Before openAt respondents get the not-yet-open screen, after closeAt (or once the response
 * limit is reached) the closed screen; JFormScreens.availabilityView cleans both.
 */
public with sharing class JFormAvailability {
    public static final String NOT_OPEN = 'notOpen';
    public static final String CLOSED = 'closed';
    public static final String CLOSED_DEFAULT = 'This form is no longer accepting responses.';

    /** 2027-01-12T17:00:00Z, with optional milliseconds and a Z or an offset; what lightning-input datetime gives. */
    private static final Pattern MOMENT = Pattern.compile('^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?(Z|[+-]\\d{2}:\\d{2})$');
    private static final List<String> DAYS = new List<String>{ 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' };
    private static final List<String> MONTHS = new List<String>{
        'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'
    };

    /** What is wrong with the stored times, one sentence each; empty when nothing is. */
    public static List<String> problems(JFormDefinition.Form def) {
        List<String> out = new List<String>();
        Map<String, Object> access = access(def);
        if (access == null) {
            return out;
        }
        Datetime openAt = moment(access.get('openAt'));
        Datetime closeAt = moment(access.get('closeAt'));
        if (!blank(access.get('openAt')) && openAt == null) {
            out.add('The opening time must be a date and time.');
        }
        if (!blank(access.get('closeAt')) && closeAt == null) {
            out.add('The closing time must be a date and time.');
        }
        if (openAt != null && closeAt != null && closeAt <= openAt) {
            out.add('The form must close after it opens.');
        }
        String zone = text(access.get('timeZone'));
        if (String.isNotBlank(zone) && zoneOf(zone) == null) {
            out.add('The time zone "' + zone.left(60) + '" is not one Salesforce knows.');
        } else if (String.isBlank(zone) && (openAt != null || closeAt != null)) {
            out.add('Pick the time zone the opening and closing times are in.');
        }
        // the older last day still closes the form while there is no closing time: it can't come before the opening
        Date lastDay = closeAt == null ? day(access.get('closeDate')) : null;
        TimeZone known = zoneOf(zone);
        if (openAt != null && lastDay != null && known != null && Date.valueOf(openAt.format('yyyy-MM-dd', known.getID())) > lastDay) {
            out.add('The form opens after its last day to respond. Remove the last day or pick a closing time.');
        }
        return out;
    }

    /** NOT_OPEN before the opening time, CLOSED after the closing time or day, null while the times allow responses. */
    public static String stateOf(JFormDefinition.Form def, Datetime now) {
        Map<String, Object> access = access(def);
        if (access == null) {
            return null;
        }
        Datetime openAt = moment(access.get('openAt'));
        if (openAt != null && now < openAt) {
            return NOT_OPEN;
        }
        Datetime closes = closesAt(def);
        return closes != null && now >= closes ? CLOSED : null;
    }

    /**
     * The moment the form stops taking responses by the clock: closeAt, else the start of the day after the older
     * closeDate in the running user's time zone; null with neither. The public form gets it, so a copy of the form
     * a cache keeps past that moment asks again.
     */
    public static Datetime closesAt(JFormDefinition.Form def) {
        Map<String, Object> access = access(def);
        if (access == null) {
            return null;
        }
        Datetime closeAt = moment(access.get('closeAt'));
        if (closeAt != null) {
            return closeAt;
        }
        Date lastDay = day(access.get('closeDate'));
        return lastDay == null ? null : Datetime.newInstance(lastDay.addDays(1), Time.newInstance(0, 0, 0, 0));
    }

    /** Whether a form that is open now can still close: it has a closing time, a last day or a response limit. */
    public static Boolean mayClose(JFormDefinition.Form def) {
        return closesAt(def) != null || responseLimit(def) != null;
    }

    /** The response limit, or null when the form has none (or an unreadable one). */
    public static Integer responseLimit(JFormDefinition.Form def) {
        Map<String, Object> access = access(def);
        Object raw = access == null ? null : access.get('responseLimit');
        if (raw == null) {
            return null;
        }
        try {
            Integer lim = Integer.valueOf(String.valueOf(raw));
            return lim > 0 ? lim : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** What a refused submission or upload says: the closed screen's message as plain text, or when the form opens. */
    public static String messageFor(JFormDefinition.Form def, String state) {
        if (state == NOT_OPEN) {
            return 'This form is not open yet. It opens on ' + opensText(def) + '.';
        }
        Map<String, Object> view = JFormScreens.availabilityView(def, CLOSED);
        String message = view.containsKey('message') ? ((String) view.get('message')).stripHtmlTags().unescapeHtml4().normalizeSpace() : '';
        return String.isBlank(message) ? CLOSED_DEFAULT : message;
    }

    /** The screen the public form shows instead of its questions: the cleaned screen, and for NOT_OPEN when it opens. */
    public static Map<String, Object> publicView(JFormDefinition.Form def, String state) {
        Map<String, Object> view = JFormScreens.availabilityView(def, state);
        view.put('state', state);
        if (state == NOT_OPEN) {
            view.put('opensAt', moment(access(def).get('openAt')).formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\''));
            view.put('opensText', opensText(def));
        }
        return view;
    }

    /** "Tuesday 12 January 2027 at 9:00 AM GMT-08:00", in the form's time zone (the running user's when it has none). */
    public static String opensText(JFormDefinition.Form def) {
        Map<String, Object> access = access(def);
        Datetime openAt = access == null ? null : moment(access.get('openAt'));
        if (openAt == null) {
            return '';
        }
        TimeZone zone = zoneOf(text(access.get('timeZone')));
        if (zone == null) {
            zone = UserInfo.getTimeZone();
        }
        // in English, as the sentence around it and jformDates: Datetime.format names days and months in the
        // site guest user's language, so the wall clock is read as numbers and named here
        Integer offset = zone.getOffset(openAt);
        Datetime wall = openAt.addSeconds(offset / 1000);
        Date day = wall.dateGmt();
        Integer hour = wall.hourGmt();
        String clock = String.valueOf(Math.mod(hour + 11, 12) + 1) + ':' + String.valueOf(wall.minuteGmt()).leftPad(2, '0') + (hour < 12 ? ' AM' : ' PM');
        String weekday = DAYS[Math.mod(Date.newInstance(1900, 1, 7).daysBetween(day), 7)];
        return weekday + ' ' + day.day() + ' ' + MONTHS[day.month() - 1] + ' ' + day.year() + ' at ' + clock + ' ' + gmtOffset(offset);
    }

    /** "GMT+11:00", "GMT-08:00" or "GMT": jformDates words the offset the same way, so the builder reads what respondents read. */
    @TestVisible
    private static String gmtOffset(Integer offsetMs) {
        if (offsetMs == 0) {
            return 'GMT';
        }
        Integer minutes = Math.abs(offsetMs) / 60000;
        return 'GMT' + (offsetMs < 0 ? '-' : '+') + String.valueOf(minutes / 60).leftPad(2, '0') + ':' + String.valueOf(Math.mod(minutes, 60)).leftPad(2, '0');
    }

    // ------------------------------------------------------------ helpers

    private static Map<String, Object> access(JFormDefinition.Form def) {
        return def != null && def.settings != null && def.settings.get('access') instanceof Map<String, Object>
            ? (Map<String, Object>) def.settings.get('access') : null;
    }

    /** A stored moment, or null when it is missing or unreadable (an unreadable time is ignored, never locks the form). */
    @TestVisible
    private static Datetime moment(Object value) {
        String s = text(value);
        if (!MOMENT.matcher(s).matches()) {
            return null;
        }
        try {
            return (Datetime) JSON.deserialize('"' + s + '"', Datetime.class);
        } catch (Exception e) {
            return null;
        }
    }

    /** The older closeDate's day, or null when it is missing or unreadable (an unreadable day is ignored). */
    private static Date day(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return Date.valueOf(String.valueOf(value).left(10));
        } catch (Exception e) {
            return null;
        }
    }

    /** The zone for an IANA id; null for an unknown one (Salesforce falls back to GMT for those). */
    @TestVisible
    private static TimeZone zoneOf(String id) {
        if (String.isBlank(id)) {
            return null;
        }
        TimeZone zone = TimeZone.getTimeZone(id);
        return zone != null && zone.getID() == id ? zone : null;
    }

    private static Boolean blank(Object value) {
        return value == null || (value instanceof String && String.isBlank((String) value));
    }

    private static String text(Object value) {
        return value instanceof String ? ((String) value).trim() : '';
    }
}
