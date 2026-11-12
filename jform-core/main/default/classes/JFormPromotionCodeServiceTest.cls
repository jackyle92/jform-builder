@IsTest
private class JFormPromotionCodeServiceTest {

    /** A form charging in the currency, with a Payment block priced per season. */
    static JFormDefinition.Form form(String currencyCode) {
        JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Codes');
        def.targetObjectApiName = null;
        def.settings.put('payments', new Map<String, Object>{ 'mode' => 'test', 'currency' => currencyCode, 'codes' => 'jform' });
        JFormDefinition.Field block = new JFormDefinition.Field();
        block.key = 'pay';
        block.fieldType = 'payment';
        block.label = 'Payment';
        block.config = new Map<String, Object>{
            'pricing' => 'choice', 'source' => 'season', 'item' => 'Ticket',
            'prices' => new List<Object>{ new Map<String, Object>{ 'value' => 'autumn', 'amount' => 45 } }
        };
        def.sections[1].fields.add(block);
        return JFormDefinitionService.create(def);
    }

    static JFormPromotionCodeService.Summary percent(String code, Decimal off) {
        JFormPromotionCodeService.Summary s = new JFormPromotionCodeService.Summary();
        s.code = code;
        s.discountType = JFormPromotionCodeService.PERCENT;
        s.percentOff = off;
        return s;
    }

    static JFormPromotionCodeService.Summary amount(String code, Decimal off) {
        JFormPromotionCodeService.Summary s = new JFormPromotionCodeService.Summary();
        s.code = code;
        s.discountType = JFormPromotionCodeService.AMOUNT;
        s.amountOff = off;
        return s;
    }

    static String saveError(Id formId, JFormPromotionCodeService.Summary s) {
        try {
            JFormPromotionCodeService.save(formId, s);
        } catch (JFormPromotionCodeService.CodeException e) {
            return e.getMessage();
        }
        return null;
    }

    /** A response of the form, for payments that count as uses. */
    static Id response(Id formId) {
        Form_Submission__c s = new Form_Submission__c(Form__c = formId, Status__c = 'New', Payment_Status__c = JFormPaymentService.AWAITING);
        insert s;
        return s.Id;
    }

    static Form_Payment__c use(Id formId, Id codeId, String status) {
        return new Form_Payment__c(Form__c = formId, Form_Submission__c = response(formId), Type__c = 'Payment', Mode__c = JFormPaymentService.TEST,
            Status__c = status, Amount__c = 4050, Amount_Refunded__c = 0, Currency__c = 'USD', Provider__c = 'Stripe', Promotion_Code__c = codeId,
            Code__c = 'SAVE10', Discount_Amount__c = 450);
    }

    @IsTest
    static void codesAreStoredUpperCaseAndCheckedByTheirTerms() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id formId = form('usd').id;
            JFormPromotionCodeService.Summary saved = JFormPromotionCodeService.save(formId, percent(' save10 ', 10));
            Assert.areEqual('SAVE10', saved.code);
            Assert.areEqual('Active', saved.state);
            Assert.areEqual(0, saved.uses);
            Assert.isTrue(saved.active);
            Assert.isNull(saved.amountOff);
            Assert.areEqual(10.00, saved.percentOff);
            JFormPromotionCodeService.Summary ten = JFormPromotionCodeService.save(formId, amount('tenoff', 10));
            Assert.areEqual('USD', ten.currencyCode, 'an amount is in the form\'s currency');
            Assert.areEqual(10.00, ten.amountOff);

            // the respondent's check: any case, trimmed; the terms come back in the smallest unit
            JFormPromotionCodeService.Verdict v = JFormPromotionCodeService.check(formId, 'USD', '  save10 ');
            Assert.isTrue(v.valid, '' + v.reason);
            Assert.areEqual(saved.id, v.codeId);
            Assert.areEqual('SAVE10', v.code);
            Assert.areEqual(JFormPromotionCodeService.PERCENT, v.discountType);
            Assert.areEqual(10.00, v.percentOff);
            Assert.isNull(v.amountOff);
            v = JFormPromotionCodeService.check(formId, 'USD', 'TENOFF');
            Assert.isTrue(v.valid, '' + v.reason);
            Assert.areEqual(1000L, v.amountOff);
            Assert.areEqual('currency', JFormPromotionCodeService.check(formId, 'EUR', 'TENOFF').reason, 'an amount off USD cannot come off a EUR total');
            Assert.isTrue(JFormPromotionCodeService.check(formId, 'EUR', 'SAVE10').valid, 'a percent works in any currency');

            for (String bad : new List<String>{ null, '', 'NOPE', 'SA', 'save 10', 'x\' OR Name != \'' }) {
                Assert.areEqual('unknown', JFormPromotionCodeService.check(formId, 'USD', bad).reason, '"' + bad + '"');
            }
            Assert.areEqual('unknown', JFormPromotionCodeService.check(form('usd').id, 'USD', 'SAVE10').reason, 'a code belongs to its form');

            // the same code again is refused by the unique key, in words
            Assert.areEqual('The code SAVE10 already exists on this form.', saveError(formId, percent('Save10', 20)));
            Assert.areEqual(2, JFormPromotionCodeService.listCodes(formId).size());
        }
    }

    @IsTest
    static void codesAreAddedAndTheirTermsChangedOnlyInJForm() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id formId = form('usd').id;
            // a record page, Data Loader or the API: no key, no upper case, the amount in the wrong unit
            Promotion_Code__c outside = new Promotion_Code__c(Form__c = formId, Name = 'summer', Discount_Type__c = JFormPromotionCodeService.AMOUNT, Amount_Off__c = 10, Currency__c = 'USD');
            Database.SaveResult added = Database.insert(outside, false);
            Assert.isFalse(added.isSuccess());
            Assert.areEqual(JFormPromotionCodeService.ADD_IN_JFORM, added.getErrors()[0].getMessage());

            Id codeId = JFormPromotionCodeService.save(formId, percent('SAVE10', 10)).id;
            for (Promotion_Code__c changed : new List<Promotion_Code__c>{
                new Promotion_Code__c(Id = codeId, Name = 'save10'),
                new Promotion_Code__c(Id = codeId, Name = 'OTHER'),
                new Promotion_Code__c(Id = codeId, Percent_Off__c = 50),
                new Promotion_Code__c(Id = codeId, Discount_Type__c = JFormPromotionCodeService.AMOUNT, Amount_Off__c = 500, Currency__c = 'USD'),
                new Promotion_Code__c(Id = codeId, Code_Key__c = 'x')
            }) {
                Database.SaveResult r = Database.update(changed, false);
                Assert.isFalse(r.isSuccess(), '' + changed);
                Assert.areEqual(JFormPromotionCodeService.CHANGE_IN_JFORM, r.getErrors()[0].getMessage(), '' + changed);
            }

            // pausing, the note, the dates and the use limit can change from Salesforce
            update new Promotion_Code__c(Id = codeId, Active__c = false, Note__c = 'Paused for the sale', Max_Uses__c = 3,
                Valid_From__c = System.now(), Valid_Until__c = System.now().addDays(7));
            Promotion_Code__c c = [SELECT Name, Active__c, Max_Uses__c, Percent_Off__c FROM Promotion_Code__c WHERE Id = :codeId];
            Assert.isFalse(c.Active__c);
            Assert.areEqual(3, c.Max_Uses__c);
            Assert.areEqual('SAVE10', c.Name);
            Assert.areEqual('inactive', JFormPromotionCodeService.check(formId, 'USD', 'SAVE10').reason);
            Assert.areEqual('The maximum number of uses is at least 1, or blank for no limit.',
                Database.update(new Promotion_Code__c(Id = codeId, Max_Uses__c = 0), false).getErrors()[0].getMessage());
            Assert.areEqual('The code must end after it starts.',
                Database.update(new Promotion_Code__c(Id = codeId, Valid_Until__c = System.now().addDays(-1)), false).getErrors()[0].getMessage());

            // JForm's own writes go through: a change in the Settings tab, Generate codes, and a delete from anywhere
            JFormPromotionCodeService.Summary edit = percent('SAVE20', 20);
            edit.id = codeId;
            Assert.areEqual('SAVE20', JFormPromotionCodeService.save(formId, edit).code);
            JFormPromotionCodeService.GenerateRequest g = new JFormPromotionCodeService.GenerateRequest();
            g.count = 3;
            g.discountType = JFormPromotionCodeService.PERCENT;
            g.percentOff = 5;
            Assert.areEqual(3, JFormPromotionCodeService.generate(formId, g).size());
            delete new Promotion_Code__c(Id = codeId);
            Assert.areEqual(3, [SELECT COUNT() FROM Promotion_Code__c WHERE Form__c = :formId]);
        }
    }

    @IsTest
    static void wrongCodesAreLimitedPerTokenAndPerForm() {
        JFormPromotionCodeService.testCounts = new Map<String, Integer>();
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id formId = form('usd').id;
            JFormPromotionCodeService.save(formId, percent('SAVE10', 10));
            Assert.isTrue(JFormPromotionCodeService.guessLimitOn());

            // the right code is never counted
            for (Integer i = 0; i < 10; i++) {
                Assert.isTrue(JFormPromotionCodeService.checkLimited(formId, 'USD', 'SAVE10', 'tok-r').valid);
            }
            // five wrong codes on one token, then that token is refused even the right one, with the same answer
            for (Integer i = 0; i < JFormPromotionCodeService.GUESSES_PER_TOKEN; i++) {
                Assert.areEqual('unknown', JFormPromotionCodeService.checkLimited(formId, 'USD', 'GUESS' + i, 'tok-a').reason);
            }
            JFormPromotionCodeService.Verdict limited = JFormPromotionCodeService.checkLimited(formId, 'USD', 'SAVE10', 'tok-a');
            Assert.isFalse(limited.valid);
            Assert.areEqual('limited', limited.reason);
            Assert.isNull(limited.codeId, 'nothing about the code comes back');
            Assert.isTrue(JFormPromotionCodeService.checkLimited(formId, 'USD', 'SAVE10', 'tok-b').valid, 'another respondent is not held back');

            // new tokens are free, so the form has its own limit; without a token only the form's counts
            for (Integer i = JFormPromotionCodeService.GUESSES_PER_TOKEN; i < JFormPromotionCodeService.GUESSES_PER_FORM; i++) {
                JFormPromotionCodeService.checkLimited(formId, 'USD', 'GUESS' + i, i < 15 ? null : 'tok-' + i);
            }
            Assert.areEqual('limited', JFormPromotionCodeService.checkLimited(formId, 'USD', 'SAVE10', 'tok-new').reason);
            Assert.areEqual('limited', JFormPromotionCodeService.checkLimited(formId, 'USD', 'SAVE10', null).reason);
            Id other = form('usd').id;
            JFormPromotionCodeService.save(other, percent('SAVE10', 10));
            Assert.isTrue(JFormPromotionCodeService.checkLimited(other, 'USD', 'SAVE10', 'tok-new').valid, 'each form counts on its own');
        }
    }

    @IsTest
    static void aCodeAppliedBeforeTheLimitStillPasses() {
        JFormPromotionCodeService.testCounts = new Map<String, Integer>();
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id formId = form('usd').id;
            JFormPromotionCodeService.save(formId, percent('SAVE10', 10));
            JFormPromotionCodeService.save(formId, percent('OTHER5', 5));
            // the respondent applies a code, then someone else's wrong codes trip the form's limit
            Assert.isTrue(JFormPromotionCodeService.checkLimited(formId, 'USD', 'save10', 'tok-a').valid);
            JFormPromotionCodeService.testCounts.put(JFormPromotionCodeService.formKey(formId), JFormPromotionCodeService.GUESSES_PER_FORM);

            // the Pay click with that code on that token still passes, and is still checked by its terms
            Assert.isTrue(JFormPromotionCodeService.checkLimited(formId, 'USD', 'SAVE10', 'tok-a').valid);
            // another code on the same token, or the same code on another token, is held back
            Assert.areEqual('limited', JFormPromotionCodeService.checkLimited(formId, 'USD', 'OTHER5', 'tok-a').reason);
            Assert.areEqual('limited', JFormPromotionCodeService.checkLimited(formId, 'USD', 'SAVE10', 'tok-b').reason);
            Assert.areEqual('limited', JFormPromotionCodeService.checkLimited(formId, 'USD', 'SAVE10', null).reason);

            Promotion_Code__c c = [SELECT Id FROM Promotion_Code__c WHERE Name = 'SAVE10' AND Form__c = :formId];
            update new Promotion_Code__c(Id = c.Id, Active__c = false);
            Assert.areEqual('inactive', JFormPromotionCodeService.checkLimited(formId, 'USD', 'SAVE10', 'tok-a').reason);
        }
    }

    @IsTest
    static void withoutPlatformCacheNothingIsCounted() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id formId = form('usd').id;
            JFormPromotionCodeService.save(formId, percent('SAVE10', 10));
            // whether the test org has capacity or not, a check still answers by the code's terms
            Boolean limitOn = JFormPromotionCodeService.guessLimitOn();
            for (Integer i = 0; i < 3; i++) {
                Assert.areEqual('unknown', JFormPromotionCodeService.checkLimited(formId, 'USD', 'GUESS' + i, 'tok').reason);
            }
            Assert.isTrue(JFormPromotionCodeService.checkLimited(formId, 'USD', 'SAVE10', 'tok').valid, 'limit on: ' + limitOn);
        }
    }

    @IsTest
    static void aCodeIsRefusedOutsideItsWindowWhilePausedOrOnceUsedUp() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id formId = form('usd').id;
            JFormPromotionCodeService.Summary s = percent('SOON', 5);
            s.validFrom = System.now().addDays(1);
            JFormPromotionCodeService.Summary soon = JFormPromotionCodeService.save(formId, s);
            Assert.areEqual('Scheduled', soon.state);
            Assert.areEqual('not_yet_valid', JFormPromotionCodeService.check(formId, 'USD', 'SOON').reason);

            s = percent('GONE', 5);
            s.validUntil = System.now().addDays(-1);
            Assert.areEqual('Expired', JFormPromotionCodeService.save(formId, s).state);
            Assert.areEqual('expired', JFormPromotionCodeService.check(formId, 'USD', 'GONE').reason);

            s = percent('OFF', 5);
            s.active = false;
            Assert.areEqual('Paused', JFormPromotionCodeService.save(formId, s).state);
            Assert.areEqual('inactive', JFormPromotionCodeService.check(formId, 'USD', 'OFF').reason);

            s = percent('LAST2', 10);
            s.maxUses = 2;
            JFormPromotionCodeService.Summary last = JFormPromotionCodeService.save(formId, s);
            Assert.isTrue(JFormPromotionCodeService.check(formId, 'USD', 'LAST2').valid);
            // a failed and an expired payment do not count; an awaiting one does, so the last use cannot be taken twice
            insert new List<Form_Payment__c>{
                use(formId, last.id, JFormPaymentService.FAILED), use(formId, last.id, JFormPaymentService.EXPIRED), use(formId, last.id, JFormPaymentService.PAID)
            };
            Assert.isTrue(JFormPromotionCodeService.check(formId, 'USD', 'LAST2').valid, 'one use of two');
            insert use(formId, last.id, JFormPaymentService.AWAITING);
            Assert.areEqual('used_up', JFormPromotionCodeService.check(formId, 'USD', 'LAST2').reason);
            Map<String, JFormPromotionCodeService.Summary> listed = new Map<String, JFormPromotionCodeService.Summary>();
            for (JFormPromotionCodeService.Summary c : JFormPromotionCodeService.listCodes(formId)) {
                listed.put(c.code, c);
            }
            Assert.areEqual(2, listed.get('LAST2').uses);
            Assert.areEqual('Used up', listed.get('LAST2').state);
            Assert.areEqual(0, listed.get('SOON').uses);

            // resumed, with the window and the limit lifted: usable again
            JFormPromotionCodeService.Summary change = listed.get('LAST2');
            change.maxUses = null;
            Assert.areEqual('Active', JFormPromotionCodeService.save(formId, change).state);
            Assert.isTrue(JFormPromotionCodeService.check(formId, 'USD', 'LAST2').valid);
            change = listed.get('OFF');
            change.active = true;
            Assert.areEqual('Active', JFormPromotionCodeService.save(formId, change).state);
            // changing the code of a used one keeps its uses
            change = listed.get('LAST2');
            change.code = 'LAST3';
            Assert.areEqual(2, JFormPromotionCodeService.save(formId, change).uses);
            Assert.areEqual('unknown', JFormPromotionCodeService.check(formId, 'USD', 'LAST2').reason);
            Assert.isTrue(JFormPromotionCodeService.check(formId, 'USD', 'LAST3').valid);
        }
    }

    @IsTest
    static void theBuildersMistakesAreNamed() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id usd = form('usd').id;
            Id jpy = form('jpy').id;
            Assert.areEqual('A code has 3 to 40 letters, digits or hyphens.', saveError(usd, percent('ab', 10)));
            Assert.areEqual('A code has 3 to 40 letters, digits or hyphens.', saveError(usd, percent('save 10', 10)));
            Assert.areEqual('A code has 3 to 40 letters, digits or hyphens.', saveError(usd, percent('A'.repeat(41), 10)));
            Assert.areEqual('The percent off is between 0.01 and 100.', saveError(usd, percent('BAD', 0)));
            Assert.areEqual('The percent off is between 0.01 and 100.', saveError(usd, percent('BAD', 100.5)));
            Assert.areEqual('The percent off is between 0.01 and 100.', saveError(usd, percent('BAD', null)));
            Assert.areEqual('The amount off is a positive amount in USD with at most two decimals.', saveError(usd, amount('BAD', 0)));
            Assert.areEqual('The amount off is a positive amount in USD with at most two decimals.', saveError(usd, amount('BAD', 1.005)));
            Assert.areEqual('The amount off is a whole number of JPY.', saveError(jpy, amount('BAD', 99.5)));
            Assert.isNull(saveError(jpy, amount('OKAY', 500)));
            JFormPromotionCodeService.Summary s = percent('BAD', 10);
            s.discountType = 'Both';
            Assert.areEqual('A code takes a percent or an amount off.', saveError(usd, s));
            s = percent('BAD', 10);
            s.validFrom = System.now();
            s.validUntil = s.validFrom.addMinutes(-1);
            Assert.areEqual('The code must end after it starts.', saveError(usd, s));
            s = percent('BAD', 10);
            s.maxUses = 0;
            Assert.areEqual('The maximum number of uses is at least 1, or blank for no limit.', saveError(usd, s));
            Assert.isTrue(JFormPromotionCodeService.listCodes(usd).isEmpty(), 'nothing of that was stored');

            // a percent with more than two decimals is rounded; a note is trimmed and cut
            s = percent('FINE', 12.345);
            s.note = '  ' + 'n'.repeat(300);
            JFormPromotionCodeService.Summary fine = JFormPromotionCodeService.save(usd, s);
            Assert.areEqual(12.35, fine.percentOff);
            Assert.areEqual(255, fine.note.length());

            // publishing a USD form with a code that takes EUR off is refused, since the discount could not be taken
            Id eur = form('eur').id;
            JFormPromotionCodeService.save(eur, amount('EURO5', 5));
            JFormPromotionCodeService.save(eur, percent('ANY', 5));
            Assert.isTrue(JFormPromotionCodeService.publishProblems(eur, 'EUR').isEmpty());
            Assert.areEqual(new List<String>{ 'The promotion code EURO5 takes EUR off, but the form charges in USD. Change or delete the code in Settings › Payments.' },
                JFormPromotionCodeService.publishProblems(eur, 'USD'));
            Assert.isTrue(JFormPromotionCodeService.publishProblems(null, 'USD').isEmpty());
        }
    }

    @IsTest
    static void anAmountCodeKeepsItsCurrencyWhenTheFormChangesItsOwn() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = form('eur');
            JFormPromotionCodeService.save(def.id, amount('TENEUR', 10));
            JFormPromotionCodeService.save(def.id, amount('BIGYEN', 1000));
            def.settings.put('payments', new Map<String, Object>{ 'mode' => 'test', 'currency' => 'usd', 'codes' => 'jform' });
            JFormDefinitionService.save(def);

            // Pause and Resume send the whole code back, as the codes list does
            for (JFormPromotionCodeService.Summary s : JFormPromotionCodeService.listCodes(def.id)) {
                s.active = false;
                JFormPromotionCodeService.save(def.id, s);
                s.active = true;
                JFormPromotionCodeService.Summary resumed = JFormPromotionCodeService.save(def.id, s);
                Assert.areEqual('EUR', resumed.currencyCode, s.code + ' stays in the currency it was made in');
                Assert.areEqual(s.code == 'TENEUR' ? 10.00 : 1000.00, resumed.amountOff);
            }
            Assert.areEqual(2, JFormPromotionCodeService.publishProblems(def.id, 'USD').size(), 'publishing still names both codes');
            Assert.areEqual(1000L, JFormPromotionCodeService.check(def.id, 'EUR', 'TENEUR').amountOff, 'still 10.00 EUR in cents');

            // a new code takes the form's new currency
            Assert.areEqual('USD', JFormPromotionCodeService.save(def.id, amount('TENUSD', 10)).currencyCode);
        }
    }

    @IsTest
    static void generatesSingleUseCodesAndExportsTheList() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id formId = form('usd').id;
            JFormPromotionCodeService.GenerateRequest r = new JFormPromotionCodeService.GenerateRequest();
            r.count = 500;
            r.prefix = ' early ';
            r.discountType = JFormPromotionCodeService.PERCENT;
            r.percentOff = 100;
            r.validUntil = Datetime.newInstanceGmt(2026, 12, 31, 23, 59, 0);
            r.note = 'Launch';
            List<JFormPromotionCodeService.Summary> made = JFormPromotionCodeService.generate(formId, r);
            Assert.areEqual(500, made.size());
            Set<String> codes = new Set<String>();
            for (JFormPromotionCodeService.Summary s : made) {
                Assert.isTrue(Pattern.matches('EARLY-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}', s.code), s.code);
                Assert.areEqual(1, s.maxUses);
                Assert.areEqual('Active', s.state);
                Assert.areEqual('Launch', s.note);
                codes.add(s.code);
            }
            Assert.areEqual(500, codes.size(), 'all different');
            Assert.areEqual(500, [SELECT COUNT() FROM Promotion_Code__c WHERE Form__c = :formId]);
            Assert.isTrue(JFormPromotionCodeService.check(formId, 'USD', made[0].code).valid);

            r.count = 501;
            try {
                JFormPromotionCodeService.generate(formId, r);
                Assert.fail();
            } catch (JFormPromotionCodeService.CodeException e) {
                Assert.areEqual('Generate between 1 and 500 codes.', e.getMessage());
            }
            r.count = 1;
            r.prefix = 'no spaces';
            try {
                JFormPromotionCodeService.generate(formId, r);
                Assert.fail();
            } catch (JFormPromotionCodeService.CodeException e) {
                Assert.areEqual('The prefix can have letters, digits and hyphens, up to 20 characters.', e.getMessage());
            }
            r.prefix = null;
            Assert.isTrue(Pattern.matches('[A-Z2-9]{8}', JFormPromotionCodeService.generate(formId, r)[0].code), 'no prefix, no hyphen');

            Id other = form('usd').id;
            JFormPromotionCodeService.Summary note = amount('Ten, "off"', 10);
            Assert.areEqual('A code has 3 to 40 letters, digits or hyphens.', saveError(other, note));
            note = amount('TEN', 10);
            note.note = 'Ten, "off"';
            note.maxUses = 5;
            JFormPromotionCodeService.save(other, note);
            JFormPromotionCodeService.Summary half = percent('HALF', 12.5);
            half.validFrom = Datetime.newInstanceGmt(2026, 11, 1, 9, 0, 0);
            half.active = false;
            JFormPromotionCodeService.save(other, half);
            String csv = JFormPromotionCodeService.exportCsv(other);
            List<String> lines = csv.split('\n');
            Assert.areEqual('Code,Discount,Valid from,Valid until,Max uses,Uses,State,Note', lines[0]);
            Assert.areEqual(3, lines.size());
            Assert.isTrue(csv.contains('HALF,12.5%,2026-11-01 09:00 UTC,,,0,Paused,'), csv);
            Assert.isTrue(csv.contains('TEN,10.00 USD,,,5,0,Active,"Ten, ""off"""'), csv);

            JFormPromotionCodeService.remove(other, half.id == null ? JFormPromotionCodeService.listCodes(other)[0].id : half.id);
            JFormPromotionCodeService.remove(formId, JFormPromotionCodeService.listCodes(other)[0].id);
            Assert.areEqual(1, JFormPromotionCodeService.listCodes(other).size(), 'deleted through the right form only');
        }
    }

    @IsTest
    static void onlyBuildersManageCodesWhileAnyFormCanCheckOne() {
        Id formId;
        Id codeId;
        // both users first: the builder's permission set is created once, and no record DML comes before the setup DML
        User builder = JFormTestDataFactory.builderUser();
        User plain = JFormTestDataFactory.plainUser('Codes');
        System.runAs(builder) {
            formId = form('usd').id;
            codeId = JFormPromotionCodeService.save(formId, percent('SAVE10', 10)).id;
        }
        System.runAs(plain) {
            // the respondent's check runs in system mode: the public controller calls it for guests
            Assert.isTrue(JFormPromotionCodeService.check(formId, 'USD', 'SAVE10').valid);
            Boolean refused = false;
            try {
                JFormPromotionCodeService.listCodes(formId);
            } catch (Exception e) {
                refused = true;
            }
            Assert.isTrue(refused, 'listing in user mode needs the permission set');
            refused = false;
            try {
                JFormPromotionCodeService.save(formId, percent('MINE', 10));
            } catch (Exception e) {
                refused = true;
            }
            Assert.isTrue(refused, 'and so does adding');
            refused = false;
            try {
                JFormPromotionCodeService.remove(formId, codeId);
            } catch (Exception e) {
                refused = true;
            }
            Assert.isTrue(refused, 'and deleting');
        }
        System.runAs(builder) {
            Assert.areEqual(1, [SELECT COUNT() FROM Promotion_Code__c WHERE Form__c = :formId]);
        }
    }
}
