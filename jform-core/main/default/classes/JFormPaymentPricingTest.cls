@IsTest
private class JFormPaymentPricingTest {

    /** The sample form with a Payment block in its first section. */
    static JFormDefinition.Form withBlock(Map<String, Object> config) {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Workshop');
        JFormDefinition.Field seats = new JFormDefinition.Field();
        seats.key = 'seats';
        seats.fieldType = 'number';
        seats.label = 'Seats';
        def.sections[0].fields.add(seats);
        JFormDefinition.Field extras = new JFormDefinition.Field();
        extras.key = 'extras';
        extras.fieldType = 'checkboxes';
        extras.label = 'Extras';
        extras.options = new List<JFormDefinition.Option>{ option('Lunch', 'lunch'), option('Notes', 'notes') };
        def.sections[0].fields.add(extras);
        JFormDefinition.Field block = new JFormDefinition.Field();
        block.key = 'pay';
        block.fieldType = 'payment';
        block.label = 'Payment';
        block.config = config;
        def.sections[0].fields.add(block);
        return def;
    }

    static JFormDefinition.Option option(String label, String value) {
        JFormDefinition.Option o = new JFormDefinition.Option();
        o.label = label;
        o.value = value;
        return o;
    }

    static JFormPaymentPricing.Quote quote(JFormDefinition.Form def, Map<String, Object> answers, String currencyCode) {
        return JFormPaymentPricing.quote(def, answers, JFormLogicEvaluator.evaluate(def, answers), currencyCode);
    }

    static String quoteError(JFormDefinition.Form def, Map<String, Object> answers, String currencyCode) {
        try {
            quote(def, answers, currencyCode);
        } catch (JFormPaymentPricing.PricingException e) {
            return e.getMessage();
        }
        return null;
    }

    @IsTest
    static void aFixedAmountIsNamedAfterTheItemOrTheForm() {
        JFormDefinition.Form def = withBlock(new Map<String, Object>{ 'pricing' => 'fixed', 'amount' => 45, 'item' => '  Workshop   ticket ' });
        JFormPaymentPricing.Quote q = quote(def, new Map<String, Object>(), 'usd');
        Assert.areEqual('USD', q.currencyCode);
        Assert.areEqual(4500L, q.amount);
        Assert.areEqual('pay', q.fieldKey);
        Assert.areEqual(45.00, q.major());
        Assert.areEqual(1, q.lines.size());
        Assert.areEqual('Workshop ticket', q.lines[0].name);
        Assert.areEqual(1, q.lines[0].quantity);

        def = withBlock(new Map<String, Object>{ 'amount' => '12.50' });
        q = quote(def, new Map<String, Object>(), null);
        Assert.areEqual(1250L, q.amount, 'pricing defaults to a fixed amount, and the currency to USD');
        Assert.areEqual('Workshop', q.lines[0].name);
    }

    @IsTest
    static void aPricePerChoiceAddsEachChoicePicked() {
        JFormDefinition.Form def = withBlock(new Map<String, Object>{
            'pricing' => 'choice', 'source' => 'extras', 'item' => 'Day pass',
            'prices' => new List<Object>{
                new Map<String, Object>{ 'value' => 'lunch', 'amount' => 12.5 },
                new Map<String, Object>{ 'value' => 'notes', 'amount' => '5' },
                new Map<String, Object>{ 'value' => 'free', 'amount' => 0 }
            }
        });
        Assert.areEqual(0L, quote(def, new Map<String, Object>(), 'USD').amount);
        JFormPaymentPricing.Quote q = quote(def, new Map<String, Object>{ 'extras' => 'lunch; notes' }, 'USD');
        Assert.areEqual(1750L, q.amount);
        Assert.areEqual('Day pass: Lunch', q.lines[0].name);
        Assert.areEqual('Day pass: Notes', q.lines[1].name);
        Assert.areEqual(500L, quote(def, new Map<String, Object>{ 'extras' => new List<Object>{ 'notes', '' } }, 'USD').amount, 'the renderer sends a list');
        // a tampered answer repeating a value is charged once
        Assert.areEqual(500L, quote(def, new Map<String, Object>{ 'extras' => new List<Object>{ 'notes', 'notes' } }, 'USD').amount);
        q = quote(def, new Map<String, Object>{ 'extras' => 'lunch; notes; lunch' }, 'USD');
        Assert.areEqual(1750L, q.amount);
        Assert.areEqual(2, q.lines.size());
    }

    @IsTest
    static void aSingleChoiceSourcePricesOneAnswer() {
        JFormDefinition.Form def = withBlock(new Map<String, Object>{
            'pricing' => 'choice', 'source' => 'season',
            'prices' => new List<Object>{
                new Map<String, Object>{ 'value' => 'Summer', 'amount' => 20 },
                new Map<String, Object>{ 'value' => 'autumn', 'amount' => 45 }
            }
        });
        Assert.areEqual(4500L, quote(def, new Map<String, Object>{ 'season' => 'autumn' }, 'USD').amount);
        Assert.areEqual(0L, quote(def, new Map<String, Object>{ 'season' => 'Summer; autumn' }, 'USD').amount, 'a picklist answer is not split');
        JFormPaymentPricing.Quote q = quote(def, new Map<String, Object>{ 'season' => new List<Object>{ 'Summer', 'autumn', 'Summer' } }, 'USD');
        Assert.areEqual(2000L, q.amount, 'a list on a single-choice field prices its first value only');
        Assert.areEqual(1, q.lines.size());
    }

    @IsTest
    static void aQuantityMustBeAWholeNumberUpToTheLimit() {
        JFormDefinition.Form def = withBlock(new Map<String, Object>{ 'pricing' => 'quantity', 'source' => 'seats', 'unitPrice' => 20 });
        JFormPaymentPricing.Quote q = quote(def, new Map<String, Object>{ 'seats' => '3' }, 'USD');
        Assert.areEqual(6000L, q.amount);
        Assert.areEqual(3, q.lines[0].quantity);
        Assert.areEqual(2000L, q.lines[0].unitAmount);
        Assert.areEqual(0L, quote(def, new Map<String, Object>{ 'seats' => '' }, 'USD').amount);
        Assert.areEqual('Enter a whole number for Seats.', quoteError(def, new Map<String, Object>{ 'seats' => '2.5' }, 'USD'));
        Assert.areEqual('Enter a whole number for Seats.', quoteError(def, new Map<String, Object>{ 'seats' => 'two' }, 'USD'));
        Assert.areEqual('Seats can be at most 1000.', quoteError(def, new Map<String, Object>{ 'seats' => 1001 }, 'USD'));
        def = withBlock(new Map<String, Object>{ 'pricing' => 'quantity', 'source' => 'seats', 'unitPrice' => 999999 });
        Assert.areEqual('The total is more than this form can take in one payment.', quoteError(def, new Map<String, Object>{ 'seats' => 1000 }, 'USD'));
    }

    @IsTest
    static void payWhatYouWantChecksTheAmountAndItsMinimum() {
        JFormDefinition.Form def = withBlock(new Map<String, Object>{ 'pricing' => 'custom', 'minimum' => 5 });
        Assert.areEqual(1250L, quote(def, new Map<String, Object>{ 'pay' => '12.50' }, 'USD').amount);
        Assert.areEqual(125000L, quote(def, new Map<String, Object>{ 'pay' => '1,250' }, 'USD').amount);
        Assert.areEqual('Enter the amount you want to pay.', quoteError(def, new Map<String, Object>(), 'USD'));
        Assert.areEqual('Enter the amount you want to pay as a number, such as 25 or 12.50.', quoteError(def, new Map<String, Object>{ 'pay' => 'lots' }, 'USD'));
        Assert.areEqual('The amount must be at least 5.00 USD.', quoteError(def, new Map<String, Object>{ 'pay' => '4.99' }, 'USD'));
        Assert.areEqual('Enter the amount with at most two decimals.', quoteError(def, new Map<String, Object>{ 'pay' => '12.505' }, 'USD'));
        Assert.areEqual('Enter the amount as a whole number.', quoteError(def, new Map<String, Object>{ 'pay' => '500.5' }, 'JPY'));
        Assert.areEqual(500L, quote(def, new Map<String, Object>{ 'pay' => '500' }, 'JPY').amount, 'yen have no smaller unit');
    }

    @IsTest
    static void aHiddenBlockOrNoBlockChargesNothing() {
        JFormDefinition.Form def = withBlock(new Map<String, Object>{ 'pricing' => 'fixed', 'amount' => 45 });
        def.sections[0].fields[def.sections[0].fields.size() - 1].conditionalLogic = JFormTestDataFactory.rule('show', 'all', 'first_name', 'equals', 'Pay');
        Assert.isNull(quote(def, new Map<String, Object>{ 'first_name' => 'Ann' }, 'USD'));
        Assert.areEqual(4500L, quote(def, new Map<String, Object>{ 'first_name' => 'Pay' }, 'USD').amount);
        Assert.isNull(quote(JFormTestDataFactory.sampleDefinition('Plain'), new Map<String, Object>(), 'USD'));
        Assert.isNull(JFormPaymentPricing.paymentField(null));
    }

    @IsTest
    static void amountsMoveBetweenUnitsWithoutRounding() {
        Assert.areEqual(29L, JFormPaymentPricing.toMinor(0.29, 'USD'));
        Assert.areEqual(1999L, JFormPaymentPricing.toMinor(19.990, 'USD'));
        Assert.isNull(JFormPaymentPricing.toMinor(19.999, 'USD'));
        Assert.isNull(JFormPaymentPricing.toMinor(null, 'USD'));
        Assert.areEqual(5000L, JFormPaymentPricing.toMinor(5000, 'VND'));
        Assert.areEqual(12.50, JFormPaymentPricing.toMajor(1250, 'USD'));
        Assert.areEqual(5000, JFormPaymentPricing.toMajor(5000, 'JPY'));
        Assert.isNull(JFormPaymentPricing.toMajor(null, 'USD'));
        Assert.areEqual('12.50 USD', JFormPaymentPricing.formatMajor(12.5, 'USD'));
        Assert.areEqual('EUR', JFormPaymentPricing.normaliseCurrency(' eur '));
        Assert.areEqual('USD', JFormPaymentPricing.normaliseCurrency(''));
        for (String code : JFormPaymentPricing.SUPPORTED) {
            Assert.areEqual(code, JFormPaymentPricing.normaliseCurrency(code.toLowerCase()));
        }
        // a code Stripe does not take, or JForm does not offer (the Settings tab lists the supported ones), is refused
        for (String bad : new List<String>{ 'KWD', 'ARS', 'XYZ', 'dollars' }) {
            try {
                JFormPaymentPricing.normaliseCurrency(bad);
                Assert.fail(bad + ' is refused');
            } catch (JFormPaymentPricing.PricingException e) {
                Assert.areEqual('This form\'s currency (' + bad.toUpperCase() + ') cannot take payments. Use one of: USD, EUR, GBP, AUD, CAD, NZD, SGD, HKD, JPY, VND, CHF, SEK, NOK, DKK, PLN, CZK, MXN, BRL, INR, ZAR, AED, THB, MYR, PHP, IDR, KRW.', e.getMessage());
            }
        }
    }

    @IsTest
    static void publishingNeedsEachPricingOptionsSettings() {
        Assert.isTrue(JFormPaymentPricing.publishProblems(JFormTestDataFactory.sampleDefinition('Plain'), 'USD').isEmpty());
        Assert.areEqual(new List<String>{ 'The Payment block needs a price.' },
            JFormPaymentPricing.publishProblems(withBlock(new Map<String, Object>{ 'pricing' => 'fixed' }), 'USD'));
        Assert.areEqual(new List<String>{ 'The Payment block needs the choice field its prices come from.' },
            JFormPaymentPricing.publishProblems(withBlock(new Map<String, Object>{ 'pricing' => 'choice', 'source' => 'seats' }), 'USD'));
        Assert.areEqual(new List<String>{ 'The Payment block needs a price for at least one option of "Extras".' },
            JFormPaymentPricing.publishProblems(withBlock(new Map<String, Object>{ 'pricing' => 'choice', 'source' => 'extras' }), 'USD'));
        Assert.areEqual(new List<String>{ 'The Payment block needs the number field that holds the quantity.', 'The Payment block needs a price for each one.' },
            JFormPaymentPricing.publishProblems(withBlock(new Map<String, Object>{ 'pricing' => 'quantity', 'source' => 'extras' }), 'USD'));
        Assert.areEqual(new List<String>{ 'The minimum amount of the Payment block must be a number.' },
            JFormPaymentPricing.publishProblems(withBlock(new Map<String, Object>{ 'pricing' => 'custom', 'minimum' => 'five' }), 'USD'));
        Assert.isTrue(JFormPaymentPricing.publishProblems(withBlock(new Map<String, Object>{ 'pricing' => 'custom' }), 'USD').isEmpty());
        for (String code : new List<String>{ 'KWD', 'ARS' }) {
            List<String> problems = JFormPaymentPricing.publishProblems(withBlock(new Map<String, Object>{ 'amount' => 5 }), code);
            Assert.areEqual(1, problems.size(), String.join(problems, ' / '));
            Assert.isTrue(problems[0].startsWith('This form\'s currency (' + code + ') cannot take payments. Use one of: USD, EUR,'), problems[0]);
        }
    }

    @IsTest
    static void aPromotionCodeComesOffTheSubtotal() {
        JFormDefinition.Form def = withBlock(new Map<String, Object>{ 'pricing' => 'quantity', 'source' => 'seats', 'unitPrice' => 20.05, 'item' => 'Seat' });
        JFormPaymentPricing.Quote q = quote(def, new Map<String, Object>{ 'seats' => 3 }, 'usd');
        Assert.areEqual(6015L, q.subtotal);
        Assert.areEqual(6015L, q.amount);
        Assert.areEqual(0L, q.discount);
        Assert.isNull(q.code);

        JFormPromotionCodeService.Verdict v = new JFormPromotionCodeService.Verdict();
        v.valid = true;
        v.code = 'SAVE10';
        v.discountType = JFormPromotionCodeService.PERCENT;
        v.percentOff = 12.5;
        JFormPaymentPricing.applyCode(q, v);
        Assert.areEqual(752L, q.discount, '751.875 rounds half up to the cent');
        Assert.areEqual(5263L, q.amount);
        Assert.areEqual(6015L, q.subtotal, 'the subtotal is what the lines add up to');
        Assert.areEqual('SAVE10', q.code);
        Assert.areEqual(1, q.lines.size(), 'the discount is not a line');

        // an amount off, capped at the subtotal: a code worth more makes the total zero
        v.discountType = JFormPromotionCodeService.AMOUNT;
        v.amountOff = 9000;
        JFormPaymentPricing.applyCode(q, v);
        Assert.areEqual(6015L, q.discount);
        Assert.areEqual(0L, q.amount);
        v.amountOff = 15;
        JFormPaymentPricing.applyCode(q, v);
        Assert.areEqual(6000L, q.amount);

        // a refused verdict changes nothing
        v.valid = false;
        v.amountOff = 100;
        JFormPaymentPricing.applyCode(q, v);
        Assert.areEqual(6000L, q.amount);
        Assert.isNull(JFormPaymentPricing.applyCode(null, v));

        // a zero-decimal currency rounds to the yen
        q = quote(withBlock(new Map<String, Object>{ 'amount' => 1005 }), new Map<String, Object>(), 'jpy');
        v.valid = true;
        v.discountType = JFormPromotionCodeService.PERCENT;
        v.percentOff = 33.33;
        JFormPaymentPricing.applyCode(q, v);
        Assert.areEqual(335L, q.discount, '334.9665 rounds to 335');
        Assert.areEqual(670L, q.amount);
    }

    @IsTest
    static void aCodeNeverLeavesLessThanTheMinimumCharge() {
        JFormPromotionCodeService.Verdict v = new JFormPromotionCodeService.Verdict();
        v.valid = true;
        v.code = 'BIG';
        v.discountType = JFormPromotionCodeService.PERCENT;
        v.percentOff = 96;
        JFormPaymentPricing.Quote q = quote(withBlock(new Map<String, Object>{ 'amount' => 10 }), new Map<String, Object>(), 'usd');
        JFormPaymentPricing.applyCode(q, v);
        Assert.areEqual(50L, q.amount, '0.40 USD is below Stripe\'s minimum, so 0.50 is charged');
        Assert.areEqual(950L, q.discount);

        // a code that makes it free stays free
        v.percentOff = 100;
        JFormPaymentPricing.applyCode(q, v);
        Assert.areEqual(0L, q.amount);

        // a subtotal already below the minimum keeps it all: no discount takes it lower
        q = quote(withBlock(new Map<String, Object>{ 'amount' => 0.30 }), new Map<String, Object>(), 'usd');
        v.percentOff = 50;
        JFormPaymentPricing.applyCode(q, v);
        Assert.areEqual(0L, q.discount);
        Assert.areEqual(30L, q.amount);

        // read from the Payment Currency records; a zero-decimal currency's minimum is in whole units
        Assert.areEqual(50L, JFormPaymentPricing.minimumCharge('JPY'));
        Assert.areEqual(30L, JFormPaymentPricing.minimumCharge('GBP'));
        Assert.areEqual(0L, JFormPaymentPricing.minimumCharge('XXX'));
        Assert.areEqual(0L, JFormPaymentPricing.minimumCharge(null));
    }

    @IsTest
    static void everySupportedCurrencyHasAPaymentCurrencyRecord() {
        // a currency added to SUPPORTED needs its Payment_Currency__mdt record (customMetadata/Payment_Currency.<code>)
        for (String c : JFormPaymentPricing.SUPPORTED) {
            Payment_Currency__mdt r = Payment_Currency__mdt.getInstance(c);
            Assert.isNotNull(r, 'no Payment Currency record for ' + c);
            Assert.isTrue(r.Minimum_Charge__c > 0, c + ' has a minimum charge');
            Assert.isNotNull(JFormPaymentPricing.toMinor(r.Minimum_Charge__c, c), c + '\'s minimum fits its decimals');
        }
    }

    @IsTest
    static void pricesMustFitTheCurrency() {
        // a price with more decimals than the currency would drop out of the total and make the response free
        Assert.areEqual(new List<String>{ 'Prices in the Payment block can have at most two decimals.' },
            JFormPaymentPricing.publishProblems(withBlock(new Map<String, Object>{ 'amount' => 12.505 }), 'USD'));
        Assert.areEqual(new List<String>{ 'Prices in the Payment block must be whole amounts in JPY.' },
            JFormPaymentPricing.publishProblems(withBlock(new Map<String, Object>{ 'pricing' => 'quantity', 'source' => 'seats', 'unitPrice' => 99.5 }), 'jpy'));
        Assert.areEqual(new List<String>{ 'Prices in the Payment block must be whole amounts in VND.' },
            JFormPaymentPricing.publishProblems(withBlock(new Map<String, Object>{
                'pricing' => 'choice', 'source' => 'extras', 'prices' => new List<Object>{ new Map<String, Object>{ 'value' => 'lunch', 'amount' => 0.5 } }
            }), 'VND'));
        Assert.areEqual(new List<String>{ 'Prices in the Payment block must be whole amounts in JPY.' },
            JFormPaymentPricing.publishProblems(withBlock(new Map<String, Object>{ 'pricing' => 'custom', 'minimum' => 1.5 }), 'JPY'));
        Assert.isTrue(JFormPaymentPricing.publishProblems(withBlock(new Map<String, Object>{ 'amount' => 5000 }), 'JPY').isEmpty());
    }

    @IsTest
    static void theAgentCanGiveTheBlocksPricingAtTheTopLevel() {
        List<JFormDefinition.Field> fields = JFormAgentSupport.parseFields(
            '[{"type":"payment","label":"Ticket","amount":45,"item":"Workshop ticket"},'
            + '{"type":"payment","label":"Donation","pricing":"custom","minimum":5,"config":{"item":"Gift"}}]', new Set<String>());
        Assert.areEqual('payment', fields[0].fieldType);
        Assert.areEqual('fixed', fields[0].config.get('pricing'));
        Assert.areEqual(45, fields[0].config.get('amount'));
        Assert.areEqual('Workshop ticket', fields[0].config.get('item'));
        Assert.areEqual('custom', fields[1].config.get('pricing'));
        Assert.areEqual(5, fields[1].config.get('minimum'));
        Assert.areEqual('Gift', fields[1].config.get('item'));
    }
}
