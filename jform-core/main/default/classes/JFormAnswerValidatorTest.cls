@IsTest
private class JFormAnswerValidatorTest {

    private static JFormDefinition.Field fieldOfType(String fieldType) {
        JFormDefinition.Field field = new JFormDefinition.Field();
        field.key = fieldType + '_key';
        field.fieldType = fieldType;
        field.label = 'My ' + fieldType;
        return field;
    }

    /** Options "Summer" (no value: matched by its label) and "Autumn" (value "autumn"). */
    private static JFormDefinition.Field seasonChoiceField(String fieldType) {
        JFormDefinition.Field field = fieldOfType(fieldType);
        field.options = new List<JFormDefinition.Option>();
        JFormDefinition.Option summer = new JFormDefinition.Option();
        summer.label = 'Summer';
        field.options.add(summer);
        JFormDefinition.Option autumn = new JFormDefinition.Option();
        autumn.label = 'Autumn';
        autumn.value = 'autumn';
        field.options.add(autumn);
        return field;
    }

    @IsTest
    static void emptyAnswersAndLayoutBlocksPass() {
        Assert.isNull(JFormAnswerValidator.problemWith(fieldOfType('email'), null));
        Assert.isNull(JFormAnswerValidator.problemWith(fieldOfType('email'), '  '));
        Assert.isNull(JFormAnswerValidator.problemWith(fieldOfType('checkboxes'), new List<Object>()));
        Assert.isNull(JFormAnswerValidator.problemWith(fieldOfType('heading'), 'anything'));
    }

    @IsTest
    static void emailFormat() {
        Assert.isNull(JFormAnswerValidator.problemWith(fieldOfType('email'), 'noah.lee@example.com'));
        Assert.areEqual('Enter a valid email address', JFormAnswerValidator.problemWith(fieldOfType('email'), 'not-an-email'));
        JFormDefinition.Field emailField = fieldOfType('email');
        emailField.validation = new JFormDefinition.Validation();
        emailField.validation.errorMessage = 'Work email please';
        Assert.areEqual('Work email please', JFormAnswerValidator.problemWith(emailField, 'a@b'), 'custom message wins');
    }

    @IsTest
    static void regexAndLength() {
        JFormDefinition.Field textField = fieldOfType('text');
        textField.validation = new JFormDefinition.Validation();
        textField.validation.regexPattern = '^[A-Z]{3}$';
        Assert.isNull(JFormAnswerValidator.problemWith(textField, 'ABC'));
        Assert.areEqual('The value does not match the expected format', JFormAnswerValidator.problemWith(textField, 'abcd'));

        textField.validation.regexPattern = '([';
        Assert.isNull(JFormAnswerValidator.problemWith(textField, 'anything'), 'a broken pattern does not block the respondent');

        textField.validation.regexPattern = null;
        textField.validation.minLength = 3;
        textField.validation.maxLength = 5;
        Assert.areEqual('Enter at least 3 characters', JFormAnswerValidator.problemWith(textField, 'ab'));
        Assert.areEqual('Enter no more than 5 characters', JFormAnswerValidator.problemWith(textField, 'abcdef'));
        Assert.isNull(JFormAnswerValidator.problemWith(textField, 'abcd'));
    }

    @IsTest
    static void numbersScoresAndRatings() {
        JFormDefinition.Field numberField = fieldOfType('number');
        numberField.validation = new JFormDefinition.Validation();
        numberField.validation.minValue = 1;
        numberField.validation.maxValue = 10;
        Assert.isNull(JFormAnswerValidator.problemWith(numberField, 5));
        Assert.areEqual('Enter a number', JFormAnswerValidator.problemWith(numberField, 'five'));
        Assert.areEqual('Enter a value of at least 1', JFormAnswerValidator.problemWith(numberField, '0'));
        Assert.areEqual('Enter a value of at most 10', JFormAnswerValidator.problemWith(numberField, 11.5));

        Assert.isNull(JFormAnswerValidator.problemWith(fieldOfType('nps'), 0));
        Assert.isNotNull(JFormAnswerValidator.problemWith(fieldOfType('nps'), 11));
        Assert.isNotNull(JFormAnswerValidator.problemWith(fieldOfType('nps'), '7.5'));
        Assert.isNull(JFormAnswerValidator.problemWith(fieldOfType('rating'), '5'));
        Assert.isNotNull(JFormAnswerValidator.problemWith(fieldOfType('rating'), 0));
    }

    @IsTest
    static void choicesMustBeListedOptions() {
        Assert.isNull(JFormAnswerValidator.problemWith(seasonChoiceField('picklist'), 'Summer'), 'option without a value matches its label');
        Assert.isNull(JFormAnswerValidator.problemWith(seasonChoiceField('radio'), 'autumn'));
        Assert.isNotNull(JFormAnswerValidator.problemWith(seasonChoiceField('picklist'), 'Winter'));
        Assert.isNotNull(JFormAnswerValidator.problemWith(seasonChoiceField('radio'), new List<Object>{ 'Summer', 'autumn' }), 'one value only');

        Assert.isNull(JFormAnswerValidator.problemWith(seasonChoiceField('checkboxes'), new List<Object>{ 'Summer', 'autumn' }));
        Assert.isNull(JFormAnswerValidator.problemWith(seasonChoiceField('multiselect'), 'Summer; autumn'), 'joined string');
        Assert.isNotNull(JFormAnswerValidator.problemWith(seasonChoiceField('multiselect'), new List<Object>{ 'Summer', 'Winter' }));
    }

    @IsTest
    static void booleansAndYesNo() {
        Assert.isNull(JFormAnswerValidator.problemWith(fieldOfType('consent'), true));
        Assert.isNull(JFormAnswerValidator.problemWith(fieldOfType('checkbox'), 'false'));
        Assert.isNotNull(JFormAnswerValidator.problemWith(fieldOfType('consent'), 'maybe'));
        Assert.isNull(JFormAnswerValidator.problemWith(fieldOfType('yesno'), 'Yes'));
        Assert.isNotNull(JFormAnswerValidator.problemWith(fieldOfType('yesno'), 'Perhaps'));
    }

    @IsTest
    static void phoneWithCountryPicker() {
        JFormDefinition.Field phoneField = fieldOfType('phone');
        phoneField.config = new Map<String, Object>{ 'countryPicker' => true };
        Assert.isNull(JFormAnswerValidator.problemWith(phoneField, '+61 412 345 678'));
        Assert.isNotNull(JFormAnswerValidator.problemWith(phoneField, '0412 345 678'), 'needs the country code');
        Assert.isNotNull(JFormAnswerValidator.problemWith(phoneField, '+1234567890123456'), 'more than 15 digits');
        Assert.isNull(JFormAnswerValidator.problemWith(fieldOfType('phone'), '0412 345 678'), 'free text without the picker');
    }

    @IsTest
    static void datesAndTimes() {
        JFormDefinition.Field dateField = fieldOfType('date');
        Assert.isNull(JFormAnswerValidator.problemWith(dateField, '2026-02-28'));
        Assert.areEqual('Enter a valid date', JFormAnswerValidator.problemWith(dateField, '2026-02-30'));
        Assert.areEqual('Enter a valid date', JFormAnswerValidator.problemWith(dateField, '28/02/2026'));

        dateField.config = new Map<String, Object>{ 'minDate' => '2026-01-01', 'maxDate' => '2026-12-31' };
        Assert.isNotNull(JFormAnswerValidator.problemWith(dateField, '2025-12-31'));
        Assert.isNotNull(JFormAnswerValidator.problemWith(dateField, '2027-01-01'));

        // 2026-10-25 is a Sunday (0), 2026-10-26 a Monday
        dateField.config = new Map<String, Object>{ 'disabledDays' => new List<Object>{ 0, 6 } };
        Assert.isNotNull(JFormAnswerValidator.problemWith(dateField, '2026-10-25'));
        Assert.isNull(JFormAnswerValidator.problemWith(dateField, '2026-10-26'));

        dateField.config = new Map<String, Object>{ 'noPast' => true };
        Assert.isNotNull(JFormAnswerValidator.problemWith(dateField, String.valueOf(Date.today().addDays(-5))));
        Assert.isNull(JFormAnswerValidator.problemWith(dateField, String.valueOf(Date.today().addDays(-1))), 'one day of slack for time zones');
        dateField.config = new Map<String, Object>{ 'noFuture' => true };
        Assert.isNotNull(JFormAnswerValidator.problemWith(dateField, String.valueOf(Date.today().addDays(5))));

        JFormDefinition.Field timeField = fieldOfType('time');
        timeField.config = new Map<String, Object>{ 'minTime' => '09:00', 'maxTime' => '17:00' };
        Assert.isNull(JFormAnswerValidator.problemWith(timeField, '09:30'));
        Assert.isNull(JFormAnswerValidator.problemWith(timeField, '12:00:00'));
        Assert.areEqual('Enter a valid time', JFormAnswerValidator.problemWith(timeField, '25:00'));
        Assert.isNotNull(JFormAnswerValidator.problemWith(timeField, '08:45'));
        Assert.isNotNull(JFormAnswerValidator.problemWith(timeField, '17:15'));
    }

    @IsTest
    static void problemsNameTheField() {
        List<String> problems = JFormAnswerValidator.findProblems(
            new List<JFormDefinition.Field>{ fieldOfType('email'), fieldOfType('number') },
            new Map<String, Object>{ 'email_key' => 'nope', 'number_key' => 3 }
        );
        Assert.areEqual(1, problems.size());
        Assert.areEqual('My email: Enter a valid email address', problems[0]);
    }

    @IsTest
    static void submitRejectsInvalidAnswers() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormPublishService.PublishResult published = JFormTestDataFactory.createAndPublish('Validated');
            Form__c form = [SELECT Id, Name, Public_Key__c, Current_Version__c, Current_Version__r.Definition_JSON__c FROM Form__c WHERE Id = :published.formId];
            JFormDefinition.Form definition = JFormDefinition.parse(form.Current_Version__r.Definition_JSON__c);
            Map<String, Object> answers = new Map<String, Object>{
                'first_name' => 'Noah', 'email' => 'noah.lee@example.com', 'season' => 'Winter', 'nps' => 9
            };
            try {
                JFormSubmissionService.submit(form, definition, answers, null);
                Assert.fail('a value outside the options must be refused');
            } catch (JFormSubmissionService.SubmissionException e) {
                Assert.isTrue(e.getMessage().startsWith('Please check: '), e.getMessage());
            }
            Assert.areEqual(0, [SELECT COUNT() FROM Form_Submission__c WHERE Form__c = :form.Id], 'nothing stored');
        }
    }
}
