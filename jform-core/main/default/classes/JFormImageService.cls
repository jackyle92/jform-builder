/**
 * Images for form themes. A file uploaded to Salesforce Files (by the Design tab's
 * Upload buttons, through lightning-file-upload) is turned into a public link whose
 * download URL works as an image source in Lightning and on Experience sites: both
 * allow the org's own file domain, while most other domains are blocked by CSP.
 *
 * Needs the org setting "Content Deliveries and Public Links" and the user
 * permission "Create Public Links" (ChatterFileLink, granted by ACCESS_FORM_BUILDER).
 */
public with sharing class JFormImageService {

    /** No SVG: a public link serves the file as is, and an SVG can carry script. */
    public static final Set<String> IMAGE_EXTENSIONS = new Set<String>{ 'png', 'jpg', 'jpeg', 'gif', 'webp' };

    public class ImageLink {
        @AuraEnabled public String url;
        @AuraEnabled public Id contentDocumentId;
        @AuraEnabled public String fileName;
    }

    @AuraEnabled
    public static ImageLink createPublicLink(Id contentDocumentId) {
        try {
            return publicLink(contentDocumentId);
        } catch (Exception e) {
            AuraHandledException ex = new AuraHandledException(e.getMessage());
            ex.setMessage(e.getMessage());
            throw ex;
        }
    }

    /** Public link for the latest version of an uploaded image, reusing one that already exists. */
    public static ImageLink publicLink(Id contentDocumentId) {
        List<ContentVersion> versions = [
            SELECT Id, Title, FileExtension, ContentDocumentId
            FROM ContentVersion
            WHERE ContentDocumentId = :contentDocumentId AND IsLatest = true
            WITH USER_MODE
            LIMIT 1
        ];
        if (versions.isEmpty()) {
            throw new JFormDefinition.JFormException('The uploaded file could not be found.');
        }
        ContentVersion v = versions[0];
        String ext = v.FileExtension == null ? '' : v.FileExtension.toLowerCase();
        if (!IMAGE_EXTENSIONS.contains(ext)) {
            throw new JFormDefinition.JFormException('"' + v.Title + '" is not an image. Upload a PNG, JPG, GIF or WebP file.');
        }
        List<ContentDistribution> existing = [
            SELECT Id, ContentDownloadUrl
            FROM ContentDistribution
            WHERE ContentVersionId = :v.Id AND PreferencesPasswordRequired = false AND PreferencesAllowViewInBrowser = true
            WITH USER_MODE
            LIMIT 1
        ];
        ContentDistribution dist;
        if (!existing.isEmpty()) {
            dist = existing[0];
        } else {
            dist = new ContentDistribution(
                Name = v.Title.left(255),
                ContentVersionId = v.Id,
                PreferencesAllowViewInBrowser = true,
                PreferencesLinkLatestVersion = true,
                PreferencesNotifyOnVisit = false,
                PreferencesPasswordRequired = false,
                PreferencesAllowOriginalDownload = true
            );
            Database.insert(dist, AccessLevel.USER_MODE);
            dist = [SELECT Id, ContentDownloadUrl FROM ContentDistribution WHERE Id = :dist.Id WITH USER_MODE];
        }
        ImageLink link = new ImageLink();
        link.url = dist.ContentDownloadUrl;
        link.contentDocumentId = v.ContentDocumentId;
        link.fileName = v.Title + (String.isBlank(ext) ? '' : '.' + ext);
        return link;
    }
}
