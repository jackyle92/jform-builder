@IsTest
private class JFormEditionTest {

    @IsTest
    static void everyFeatureIsOn() {
        for (JFormEdition.Feature f : JFormEdition.Feature.values()) {
            Assert.isTrue(JFormEdition.isEnabled(f), f.name() + ' needs no license key');
        }
    }
}
