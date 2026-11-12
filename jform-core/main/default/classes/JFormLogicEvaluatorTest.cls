@IsTest
private class JFormLogicEvaluatorTest {

    private static JFormDefinition.Condition cond(String field, String op, String value) {
        JFormDefinition.Condition c = new JFormDefinition.Condition();
        c.field = field;
        c.operator = op;
        c.value = value;
        return c;
    }

    @IsTest
    static void operators() {
        Assert.isTrue(JFormLogicEvaluator.test(cond('a', 'equals', 'summer'), 'Summer'), 'equals is case-insensitive');
        Assert.isFalse(JFormLogicEvaluator.test(cond('a', 'equals', 'Summer'), 'Autumn'));
        Assert.isTrue(JFormLogicEvaluator.test(cond('a', 'equals', 'Vegan'), new List<Object>{ 'None', 'Vegan' }), 'equals on a list means contains element');
        Assert.isTrue(JFormLogicEvaluator.test(cond('a', 'not_equals', 'Summer'), 'Autumn'));
        Assert.isTrue(JFormLogicEvaluator.test(cond('a', 'not_equals', 'Summer'), null), 'no answer is not equal');
        Assert.isTrue(JFormLogicEvaluator.test(cond('a', 'contains', 'sum'), 'Summer'));
        Assert.isFalse(JFormLogicEvaluator.test(cond('a', 'contains', 'x'), 'Summer'));
        Assert.isTrue(JFormLogicEvaluator.test(cond('a', 'is_empty', null), ''));
        Assert.isTrue(JFormLogicEvaluator.test(cond('a', 'is_empty', null), new List<Object>()));
        Assert.isFalse(JFormLogicEvaluator.test(cond('a', 'is_empty', null), 'x'));
        Assert.isTrue(JFormLogicEvaluator.test(cond('a', 'is_not_empty', null), 'x'));
        Assert.isTrue(JFormLogicEvaluator.test(cond('a', 'greater_than', '5'), 9));
        Assert.isTrue(JFormLogicEvaluator.test(cond('a', 'greater_than', '5'), '9'));
        Assert.isFalse(JFormLogicEvaluator.test(cond('a', 'greater_than', '5'), '3'));
        Assert.isTrue(JFormLogicEvaluator.test(cond('a', 'less_than', '5'), 3));
        Assert.isFalse(JFormLogicEvaluator.test(cond('a', 'less_than', '5'), 'abc'), 'non-numeric never compares');
        Assert.isTrue(JFormLogicEvaluator.test(cond('a', 'equals', 'true'), true), 'booleans compare as strings');
    }

    @IsTest
    static void matchAllAndAny() {
        JFormDefinition.Rule all = new JFormDefinition.Rule();
        all.action = 'show';
        all.match = 'all';
        all.conditions.add(cond('a', 'equals', '1'));
        all.conditions.add(cond('b', 'equals', '2'));
        Assert.isTrue(JFormLogicEvaluator.matches(all, new Map<String, Object>{ 'a' => '1', 'b' => '2' }));
        Assert.isFalse(JFormLogicEvaluator.matches(all, new Map<String, Object>{ 'a' => '1', 'b' => '3' }));

        JFormDefinition.Rule anyRule = new JFormDefinition.Rule();
        anyRule.action = 'show';
        anyRule.match = 'any';
        anyRule.conditions = all.conditions;
        Assert.isTrue(JFormLogicEvaluator.matches(anyRule, new Map<String, Object>{ 'a' => '1', 'b' => '3' }));
        Assert.isFalse(JFormLogicEvaluator.matches(anyRule, new Map<String, Object>{ 'a' => '0', 'b' => '3' }));

        Assert.isTrue(JFormLogicEvaluator.matches(null, new Map<String, Object>()), 'no rule always matches');
    }

    @IsTest
    static void evaluateVisibilityAndRequire() {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Logic');
        // make the whole survey page hide when first_name equals "skip"
        def.sections[1].conditionalLogic = JFormTestDataFactory.rule('hide', 'all', 'first_name', 'equals', 'skip');
        // require email when nps is less than 7
        def.sections[0].fields[2].required = false;
        def.sections[0].fields[2].conditionalLogic = JFormTestDataFactory.rule('require', 'all', 'nps', 'less_than', '7');
        // a Payment block flagged required, with the same require rule: the flag can arrive through the API or the agent
        JFormDefinition.Field pay = new JFormDefinition.Field();
        pay.key = 'pay';
        pay.fieldType = 'payment';
        pay.label = 'Payment';
        pay.required = true;
        pay.conditionalLogic = JFormTestDataFactory.rule('require', 'all', 'nps', 'less_than', '7');
        def.sections[0].fields.add(pay);

        JFormLogicEvaluator.Result r = JFormLogicEvaluator.evaluate(def, new Map<String, Object>{ 'season' => 'Summer', 'nps' => 4 });
        Assert.isTrue(r.visible.get('why_summer'), 'show rule matched');
        Assert.isTrue(r.required.get('why_summer'), 'static required kept when visible');
        Assert.isTrue(r.visible.get('season'));
        Assert.isTrue(r.required.get('email'), 'require rule matched');
        Assert.isTrue(r.visible.get('intro'));
        Assert.isTrue(r.visible.get('pay'));
        Assert.isFalse(r.required.get('pay'), 'a Payment block is never required: its price decides whether there is anything to pay');

        r = JFormLogicEvaluator.evaluate(def, new Map<String, Object>{ 'season' => 'autumn', 'nps' => 9 });
        Assert.isFalse(r.visible.get('why_summer'), 'show rule not matched');
        Assert.isFalse(r.required.get('why_summer'), 'hidden fields are never required');
        Assert.isFalse(r.required.get('email'), 'require rule not matched and no static flag');

        r = JFormLogicEvaluator.evaluate(def, new Map<String, Object>{ 'first_name' => 'skip', 'season' => 'Summer' });
        Assert.isFalse(r.sectionVisible.get('survey'), 'page hidden');
        Assert.isFalse(r.visible.get('season'), 'fields of a hidden page are hidden');
        Assert.isFalse(r.visible.get('why_summer'), 'even when their own rule matches');
        Assert.isTrue(r.visible.get('first_name'), 'other page unaffected');

        r = JFormLogicEvaluator.evaluate(def, null);
        Assert.isTrue(r.visible.get('first_name'), 'null answers are treated as empty');
    }
}
