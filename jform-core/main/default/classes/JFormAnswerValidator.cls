/**
 * Server-side check of submitted answers against the published form.
 * Mirrors validateValue() in c/jformFieldRegistry so a submission that skips the
 * renderer (a direct Apex or REST call) meets the same rules: formats, the
 * field's validation (regex, length, value range), choice values (with Other, JFormOtherChoice), how many
 * choices a Checkboxes field takes, and date/time limits.
 *
 * Phone numbers with the country picker are checked for shape only (+ and 4 to 15
 * digits); the per-country rules of c/jformPhone stay in the renderer.
 */
public inherited sharing class JFormAnswerValidator {

    private static final Pattern EMAIL_PATTERN = Pattern.compile('^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$');
    private static final Pattern ISO_DATE_PATTERN = Pattern.compile('^(\\d{4})-(\\d{2})-(\\d{2})$');
    private static final Pattern ISO_TIME_PATTERN = Pattern.compile('^(\\d{2}):(\\d{2})(?::\\d{2}(?:\\.\\d+)?)?$');
    private static final Set<String> SINGLE_CHOICE_TYPES = new Set<String>{ 'picklist', 'radio' };
    private static final Set<String> MULTI_CHOICE_TYPES = new Set<String>{ 'multiselect', 'checkboxes' };
    private static final Set<String> BOOLEAN_TYPES = new Set<String>{ 'consent', 'checkbox' };
    private static final Set<String> BOOLEAN_ANSWERS = new Set<String>{ 'true', 'false' };
    private static final Set<String> YES_NO_ANSWERS = new Set<String>{ 'yes', 'no', 'true', 'false' };
    private static final Integer MIN_PHONE_DIGITS = 4;
    private static final Integer MAX_PHONE_DIGITS = 15; // E.164
    private static final Integer MAX_NPS_SCORE = 10;
    private static final Integer MAX_RATING = 5;

    /** Whether a text is an email address by the Email field's rule (used by JFormPaymentService too). */
    public static Boolean isEmailAddress(String text) {
        return text != null && EMAIL_PATTERN.matcher(text).matches();
    }

    /** Problems with the answers to the given fields, as "Label: message"; empty when all pass. */
    public static List<String> findProblems(List<JFormDefinition.Field> fields, Map<String, Object> answers) {
        List<String> problems = new List<String>();
        for (JFormDefinition.Field field : fields) {
            if (JFormTableService.isTable(field)) {
                problems.addAll(tableProblems(field, answers));
                continue;
            }
            if (JFormFieldParts.isCompound(field)) {
                // a Name or Address answer arrives one per part ("field.part", see JFormFieldParts.expand), trimmed
                problems.addAll(JFormFieldParts.lengthProblems(field, answers));
                continue;
            }
            String problem = problemWith(field, answers.get(field.key));
            if (problem != null) {
                String fieldName = String.isBlank(field.label) ? field.key : field.label;
                problems.add(fieldName + ': ' + problem);
            }
            String otherProblem = JFormOtherChoice.problem(field, answers);
            if (otherProblem != null) {
                problems.add(otherProblem);
            }
        }
        return problems;
    }

    /** Why one answer is not acceptable, or null. Empty answers pass: required-ness depends on logic and is checked by the caller. */
    public static String problemWith(JFormDefinition.Field field, Object answer) {
        if (field == null || JFormDefinition.LAYOUT_TYPES.contains(field.fieldType) || JFormSubmissionService.isEmpty(answer)) {
            return null;
        }
        String fieldType = field.fieldType == null ? 'text' : field.fieldType.toLowerCase();
        JFormDefinition.Validation rules = field.validation == null ? new JFormDefinition.Validation() : field.validation;
        String customMessage = String.isBlank(rules.errorMessage) ? null : rules.errorMessage;

        if (SINGLE_CHOICE_TYPES.contains(fieldType) || MULTI_CHOICE_TYPES.contains(fieldType)) {
            Boolean allowsMany = MULTI_CHOICE_TYPES.contains(fieldType);
            Set<String> allowed = allowedValues(field);
            List<String> chosen = chosenValues(answer, allowsMany, allowed);
            String problem = choiceProblem(chosen, allowed, allowsMany);
            return problem == null && allowsMany ? countProblem(field, chosen.size(), allowed.size()) : problem;
        }
        String answerText = JFormSubmissionService.stringify(answer);
        if (BOOLEAN_TYPES.contains(fieldType)) {
            return BOOLEAN_ANSWERS.contains(answerText.trim().toLowerCase()) ? null : 'Choose yes or no.';
        }
        if (fieldType == 'yesno') {
            return YES_NO_ANSWERS.contains(answerText.trim().toLowerCase()) ? null : 'Choose Yes or No.';
        }
        if (fieldType == 'email' && !EMAIL_PATTERN.matcher(answerText).matches()) {
            return messageOr(customMessage, 'Enter a valid email address');
        }
        if (fieldType == 'phone' && isConfigFlagOn(field.config, 'countryPicker')) {
            return isInternationalNumber(answerText) ? null : messageOr(customMessage, 'Enter the full number, starting with + and the country code.');
        }
        if (String.isNotBlank(rules.regexPattern) && !matchesPattern(rules.regexPattern, answerText)) {
            return messageOr(customMessage, 'The value does not match the expected format');
        }
        if (rules.minLength != null && answerText.length() < rules.minLength) {
            return messageOr(customMessage, 'Enter at least ' + rules.minLength + ' characters');
        }
        if (rules.maxLength != null && answerText.length() > rules.maxLength) {
            return messageOr(customMessage, 'Enter no more than ' + rules.maxLength + ' characters');
        }
        if (fieldType == 'date') {
            String problem = dateProblem(answerText.trim(), field.config);
            return problem == null ? null : messageOr(customMessage, problem);
        }
        if (fieldType == 'time') {
            String problem = timeProblem(answerText.trim(), field.config);
            return problem == null ? null : messageOr(customMessage, problem);
        }
        if (fieldType == 'number' || fieldType == 'nps' || fieldType == 'rating') {
            return numberProblem(fieldType, rules, customMessage, answerText);
        }
        return null;
    }

    // ------------------------------------------------------------ numbers

    private static String numberProblem(String fieldType, JFormDefinition.Validation rules, String customMessage, String answerText) {
        Decimal numberValue = parseDecimal(answerText);
        if (numberValue == null) {
            return messageOr(customMessage, 'Enter a number');
        }
        if (fieldType == 'nps' && !isWholeNumberBetween(numberValue, 0, MAX_NPS_SCORE)) {
            return 'Choose a score from 0 to ' + MAX_NPS_SCORE;
        }
        if (fieldType == 'rating' && !isWholeNumberBetween(numberValue, 1, MAX_RATING)) {
            return 'Choose a rating from 1 to ' + MAX_RATING;
        }
        if (rules.minValue != null && numberValue < rules.minValue) {
            return messageOr(customMessage, 'Enter a value of at least ' + rules.minValue);
        }
        if (rules.maxValue != null && numberValue > rules.maxValue) {
            return messageOr(customMessage, 'Enter a value of at most ' + rules.maxValue);
        }
        return null;
    }

    private static Boolean isWholeNumberBetween(Decimal numberValue, Integer lowest, Integer highest) {
        return numberValue >= lowest && numberValue <= highest && numberValue == numberValue.round(System.RoundingMode.DOWN);
    }

    // ------------------------------------------------------------ choices

    /** A table's answers arrive one per row ("field.row", see JFormTableService.expand): each must be one of the columns. */
    private static List<String> tableProblems(JFormDefinition.Field field, Map<String, Object> answers) {
        List<String> problems = new List<String>();
        String fieldName = String.isBlank(field.label) ? field.key : field.label;
        for (JFormTableService.Row row : JFormTableService.rows(field)) {
            Object rowAnswer = answers.get(JFormTableService.answerKey(field, row));
            String problem = JFormSubmissionService.isEmpty(rowAnswer) ? null : choiceProblem(field, rowAnswer, JFormTableService.multiple(field));
            if (problem != null) {
                problems.add(fieldName + ' (' + (String.isBlank(row.label) ? row.key : row.label) + '): ' + problem);
            }
        }
        return problems;
    }

    /**
     * Every chosen value must be one of the field's options (an option without a value is matched by its label, as in
     * the renderer), or its Other choice.
     */
    private static String choiceProblem(JFormDefinition.Field field, Object answer, Boolean allowsMany) {
        Set<String> allowedValues = allowedValues(field);
        return choiceProblem(chosenValues(answer, allowsMany, allowedValues), allowedValues, allowsMany);
    }

    private static String choiceProblem(List<String> chosenValues, Set<String> allowedValues, Boolean allowsMany) {
        if (!allowsMany && chosenValues.size() > 1) {
            return 'Choose one option.';
        }
        for (String chosen : chosenValues) {
            if (!allowedValues.contains(chosen)) {
                return 'Choose one of the listed options.';
            }
        }
        return null;
    }

    private static Set<String> allowedValues(JFormDefinition.Field field) {
        Set<String> allowedValues = new Set<String>();
        if (field.options != null) {
            for (JFormDefinition.Option option : field.options) {
                allowedValues.add(String.isNotBlank(option.value) ? option.value : option.label);
            }
        }
        if (JFormOtherChoice.offered(field)) {
            allowedValues.add(JFormOtherChoice.value(field));
        }
        return allowedValues;
    }

    /**
     * Checkboxes' At least and At most (config.minChoices, config.maxChoices). An empty answer passes, as for length
     * rules: whether one is needed is the required check's job. Mirrors choiceCountProblem() in c/jformFieldRegistry.
     */
    private static String countProblem(JFormDefinition.Field field, Integer chosen, Integer choices) {
        List<Integer> limits = limits(field, choices);
        if (limits[0] != null && chosen < limits[0]) {
            return 'Choose at least ' + limits[0] + '.';
        }
        if (limits[1] != null && chosen > limits[1]) {
            return 'Choose no more than ' + limits[1] + '.';
        }
        return null;
    }

    /**
     * At least and At most as they apply, [least, most] with null for none. Saved limits can outgrow the choices when
     * some are removed later, so At least never asks for more than there are, At most stops counting once it reaches
     * them, and At least never passes At most. Mirrors choiceLimits() in c/jformFieldRegistry.
     */
    @TestVisible
    private static List<Integer> limits(JFormDefinition.Field field, Integer choices) {
        Integer least = field.config == null ? null : JFormFieldParts.intOf(field.config.get('minChoices'));
        Integer most = field.config == null ? null : JFormFieldParts.intOf(field.config.get('maxChoices'));
        if (most != null && (most < 1 || most >= choices)) {
            most = null;
        }
        if (least != null) {
            least = Math.min(least, most == null ? choices : most);
        }
        return new List<Integer>{ least != null && least > 1 ? least : null, most };
    }

    /** The values in a choice answer: a list, or a single value; a multi-choice answer may arrive joined with "; " (REST callers, stored values). */
    private static List<String> chosenValues(Object answer, Boolean allowsMany, Set<String> allowedValues) {
        List<String> values = new List<String>();
        if (answer instanceof List<Object>) {
            for (Object item : (List<Object>) answer) {
                if (item != null) {
                    values.add(String.valueOf(item));
                }
            }
            return values;
        }
        String answerText = String.valueOf(answer);
        if (allowsMany && !allowedValues.contains(answerText) && answerText.contains(';')) {
            for (String part : answerText.split(';')) {
                if (String.isNotBlank(part)) {
                    values.add(part.trim());
                }
            }
        } else {
            values.add(answerText);
        }
        return values;
    }

    // ------------------------------------------------------------ dates and times

    private static String dateProblem(String isoDate, Map<String, Object> config) {
        Date answerDate = parseIsoDate(isoDate);
        if (answerDate == null) {
            return 'Enter a valid date';
        }
        // "today" is the respondent's; the server's can be a day off either way, so noPast/noFuture allow one day
        Date today = Date.today();
        Date earliest = parseIsoDate(configValue(config, 'minDate'));
        Date latest = parseIsoDate(configValue(config, 'maxDate'));
        if (isConfigFlagOn(config, 'noPast') && (earliest == null || earliest < today.addDays(-1))) {
            earliest = today.addDays(-1);
        }
        if (isConfigFlagOn(config, 'noFuture') && (latest == null || latest > today.addDays(1))) {
            latest = today.addDays(1);
        }
        if (earliest != null && answerDate < earliest) {
            return 'Choose a date on or after ' + String.valueOf(earliest);
        }
        if (latest != null && answerDate > latest) {
            return 'Choose a date on or before ' + String.valueOf(latest);
        }
        if (isDisabledWeekday(answerDate, config)) {
            return 'Choose a date on an available day of the week';
        }
        return null;
    }

    /** config.disabledDays lists weekdays the form does not accept: 0 = Sunday … 6 = Saturday, as Date.getUTCDay() in the renderer. */
    private static Boolean isDisabledWeekday(Date answerDate, Map<String, Object> config) {
        Object disabledDays = config == null ? null : config.get('disabledDays');
        if (!(disabledDays instanceof List<Object>)) {
            return false;
        }
        // 'u' is 1 = Monday … 7 = Sunday; mod 7 makes Sunday 0
        Integer weekday = Math.mod(Integer.valueOf(Datetime.newInstanceGmt(answerDate, Time.newInstance(12, 0, 0, 0)).formatGmt('u')), 7);
        for (Object disabledDay : (List<Object>) disabledDays) {
            if (parseDecimal(String.valueOf(disabledDay)) == weekday) {
                return true;
            }
        }
        return false;
    }

    private static String timeProblem(String isoTime, Map<String, Object> config) {
        Integer answerMinutes = minutesSinceMidnight(isoTime);
        if (answerMinutes == null) {
            return 'Enter a valid time';
        }
        Integer earliestMinutes = minutesSinceMidnight(configValue(config, 'minTime'));
        Integer latestMinutes = minutesSinceMidnight(configValue(config, 'maxTime'));
        if (earliestMinutes != null && answerMinutes < earliestMinutes) {
            return 'Choose a time at or after ' + configValue(config, 'minTime');
        }
        if (latestMinutes != null && answerMinutes > latestMinutes) {
            return 'Choose a time at or before ' + configValue(config, 'maxTime');
        }
        return null;
    }

    private static Date parseIsoDate(String isoDate) {
        if (String.isBlank(isoDate)) {
            return null;
        }
        Matcher dateParts = ISO_DATE_PATTERN.matcher(isoDate);
        if (!dateParts.matches()) {
            return null;
        }
        Integer year = Integer.valueOf(dateParts.group(1));
        Integer month = Integer.valueOf(dateParts.group(2));
        Integer day = Integer.valueOf(dateParts.group(3));
        if (year < 1700 || month < 1 || month > 12 || day < 1 || day > Date.daysInMonth(year, month)) {
            return null;
        }
        return Date.newInstance(year, month, day);
    }

    /** "HH:mm" (seconds tolerated) to minutes since midnight, or null. */
    private static Integer minutesSinceMidnight(String isoTime) {
        if (String.isBlank(isoTime)) {
            return null;
        }
        Matcher timeParts = ISO_TIME_PATTERN.matcher(isoTime.trim());
        if (!timeParts.matches()) {
            return null;
        }
        Integer hours = Integer.valueOf(timeParts.group(1));
        Integer minutes = Integer.valueOf(timeParts.group(2));
        return hours > 23 || minutes > 59 ? null : hours * 60 + minutes;
    }

    // ------------------------------------------------------------ helpers

    private static String messageOr(String customMessage, String defaultMessage) {
        return customMessage != null ? customMessage : defaultMessage;
    }

    /** + then 4 to 15 digits once spaces and punctuation are removed. */
    private static Boolean isInternationalNumber(String answerText) {
        String trimmed = answerText.trim();
        if (!trimmed.startsWith('+')) {
            return false;
        }
        Integer digitCount = trimmed.replaceAll('\\D', '').length();
        return digitCount >= MIN_PHONE_DIGITS && digitCount <= MAX_PHONE_DIGITS;
    }

    /** RegExp.test() semantics: a match anywhere. A pattern Apex cannot compile or run does not block the respondent, as in the renderer. */
    private static Boolean matchesPattern(String regex, String answerText) {
        try {
            return Pattern.compile(regex).matcher(answerText).find();
        } catch (Exception e) {
            return true;
        }
    }

    private static Decimal parseDecimal(String text) {
        try {
            return Decimal.valueOf(text.trim());
        } catch (Exception e) {
            return null;
        }
    }

    private static Boolean isConfigFlagOn(Map<String, Object> config, String key) {
        return config != null && config.get(key) == true;
    }

    private static String configValue(Map<String, Object> config, String key) {
        return config == null || config.get(key) == null ? null : String.valueOf(config.get(key));
    }
}
