@IsTest
private class JFormImageServiceTest {

    private static Id upload(String title, String path) {
        ContentVersion cv = new ContentVersion(Title = title, PathOnClient = path, VersionData = Blob.valueOf('bytes of ' + path));
        insert cv;
        return [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id].ContentDocumentId;
    }

    @IsTest
    static void createsAndReusesPublicLinkForImages() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id docId = upload('logo', 'logo.PNG');

            JFormImageService.ImageLink link = JFormImageService.createPublicLink(docId);

            Assert.isTrue(link.url.contains('/sfc/dist/version/download/'), link.url);
            Assert.areEqual('logo.png', link.fileName);
            Assert.areEqual(docId, link.contentDocumentId);

            JFormImageService.ImageLink again = JFormImageService.createPublicLink(docId);
            Assert.areEqual(link.url, again.url, 'second call reuses the link');
            Assert.areEqual(1, [SELECT COUNT() FROM ContentDistribution WHERE ContentDocumentId = :docId]);
        }
    }

    @IsTest
    static void rejectsNonImagesAndMissingFiles() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            Id notesId = upload('notes', 'notes.txt');
            try {
                JFormImageService.publicLink(notesId);
                Assert.fail('text files are not images');
            } catch (JFormDefinition.JFormException e) {
                Assert.isTrue(e.getMessage().contains('not an image'), e.getMessage());
            }
            try {
                JFormImageService.createPublicLink(notesId);
                Assert.fail('the Aura wrapper rethrows');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().contains('not an image'), e.getMessage());
            }
            try {
                JFormImageService.publicLink(ContentDocument.SObjectType.getDescribe().getKeyPrefix() + '000000000000');
                Assert.fail('missing files fail');
            } catch (JFormDefinition.JFormException e) {
                Assert.isTrue(e.getMessage().contains('could not be found'), e.getMessage());
            }
            Id drawingId = upload('drawing', 'drawing.svg');
            try {
                JFormImageService.publicLink(drawingId);
                Assert.fail('SVG can carry script, so it gets no public link');
            } catch (JFormDefinition.JFormException e) {
                Assert.isTrue(e.getMessage().contains('not an image'), e.getMessage());
            }
            Assert.areEqual(0, [SELECT COUNT() FROM ContentDistribution WHERE ContentDocumentId IN (:notesId, :drawingId)]);
        }
    }
}
