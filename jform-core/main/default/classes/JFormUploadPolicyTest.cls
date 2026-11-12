@IsTest
private class JFormUploadPolicyTest {

    private static JFormDefinition.Field uploadField(String fileType) {
        JFormDefinition.Field field = new JFormDefinition.Field();
        field.key = 'upload';
        field.fieldType = 'fileupload';
        field.label = 'Upload';
        field.fileType = fileType;
        return field;
    }

    @IsTest
    static void anyFileTypeAllowsImagesDocumentsAndAudio() {
        JFormDefinition.Field anyType = uploadField(null);
        Assert.isNull(JFormUploadPolicy.problemWith(anyType, 'photo.JPG'), 'extension check ignores case');
        Assert.isNull(JFormUploadPolicy.problemWith(anyType, 'cv.pdf'));
        Assert.isNull(JFormUploadPolicy.problemWith(anyType, 'voice.m4a'));
    }

    @IsTest
    static void webContentAndExecutablesAreRefused() {
        JFormDefinition.Field anyType = uploadField(null);
        for (String fileName : new List<String>{ 'page.html', 'logo.svg', 'script.js', 'setup.exe', 'noextension', 'photo.png.html' }) {
            Assert.isNotNull(JFormUploadPolicy.problemWith(anyType, fileName), fileName + ' must be refused');
        }
    }

    @IsTest
    static void fileTypeNarrowsTheList() {
        Assert.isNull(JFormUploadPolicy.problemWith(uploadField('Image'), 'photo.png'));
        Assert.isNotNull(JFormUploadPolicy.problemWith(uploadField('Image'), 'cv.pdf'));
        Assert.isNull(JFormUploadPolicy.problemWith(uploadField('Document'), 'cv.docx'));
        Assert.isNotNull(JFormUploadPolicy.problemWith(uploadField('Audio'), 'photo.png'));
        String message = JFormUploadPolicy.problemWith(uploadField('Audio'), 'photo.png');
        Assert.isTrue(message.contains('mp3'), 'the message lists what is allowed: ' + message);
    }

    private static JFormDefinition.Field withConfig(String fileType, Map<String, Object> config) {
        JFormDefinition.Field field = uploadField(fileType);
        field.config = config;
        return field;
    }

    @IsTest
    static void onlyTheseNarrowsTheList() {
        JFormDefinition.Field sheets = withConfig(null, new Map<String, Object>{ 'extensions' => new List<Object>{ 'pdf', 'XLS', 'xlsx', '.csv' } });
        Assert.areEqual(new Set<String>{ 'pdf', 'xls', 'xlsx', 'csv' }, JFormUploadPolicy.allowedExtensions(sheets));
        Assert.isNull(JFormUploadPolicy.problemWith(sheets, 'hours.CSV'));
        Assert.isNotNull(JFormUploadPolicy.problemWith(sheets, 'cv.docx'));
        Assert.isNotNull(JFormUploadPolicy.problemWith(sheets, 'photo.png'));
    }

    @IsTest
    static void onlyTheseNeverWidensTheAllowlist() {
        JFormDefinition.Field widened = withConfig(null, new Map<String, Object>{ 'extensions' => new List<Object>{ 'pdf', 'exe', 'svg', 'html' } });
        Assert.areEqual(new Set<String>{ 'pdf' }, JFormUploadPolicy.allowedExtensions(widened));
        Assert.isNotNull(JFormUploadPolicy.problemWith(widened, 'setup.exe'));
        JFormDefinition.Field images = withConfig('Image', new Map<String, Object>{ 'extensions' => new List<Object>{ 'png', 'pdf' } });
        Assert.areEqual(new Set<String>{ 'png' }, JFormUploadPolicy.allowedExtensions(images), 'the file type still applies');
        JFormDefinition.Field broken = withConfig(null, new Map<String, Object>{ 'extensions' => 'pdf' });
        Assert.isTrue(JFormUploadPolicy.allowedExtensions(broken).isEmpty(), 'a broken setting takes nothing rather than everything');
    }

    @IsTest
    static void limitsFallBackToTheMost() {
        Assert.areEqual(3, JFormUploadPolicy.maxSizeMb(uploadField(null)));
        Assert.areEqual(10, JFormUploadPolicy.maxFiles(uploadField(null)));
        JFormDefinition.Field limited = withConfig(null, new Map<String, Object>{ 'maxSizeMb' => 2, 'maxFiles' => '3' });
        Assert.areEqual(2, JFormUploadPolicy.maxSizeMb(limited));
        Assert.areEqual(3, JFormUploadPolicy.maxFiles(limited));
        JFormDefinition.Field outOfRange = withConfig(null, new Map<String, Object>{ 'maxSizeMb' => 9, 'maxFiles' => 0 });
        Assert.areEqual(3, JFormUploadPolicy.maxSizeMb(outOfRange));
        Assert.areEqual(10, JFormUploadPolicy.maxFiles(outOfRange));
        Assert.areEqual(3, JFormUploadPolicy.maxSizeMb(withConfig(null, new Map<String, Object>{ 'maxSizeMb' => 1.5 })));
    }

    @IsTest
    static void configProblemsRefuseWhatCannotWork() {
        Assert.isTrue(JFormUploadPolicy.configProblems(withConfig(null, new Map<String, Object>{
            'extensions' => new List<Object>{ 'pdf', 'csv' }, 'maxSizeMb' => 2, 'maxFiles' => 3
        })).isEmpty());
        Assert.areEqual(new List<String>{ 'Field "Upload": tick at least one file type.' },
            JFormUploadPolicy.configProblems(withConfig(null, new Map<String, Object>{ 'extensions' => new List<Object>() })));
        Assert.areEqual(new List<String>{ 'Field "Upload" cannot take files of type exe, svg.' },
            JFormUploadPolicy.configProblems(withConfig(null, new Map<String, Object>{ 'extensions' => new List<Object>{ 'svg', 'pdf', 'exe' } })));
        Assert.areEqual(new List<String>{ 'Field "Upload" cannot take files of type pdf.' },
            JFormUploadPolicy.configProblems(withConfig('Image', new Map<String, Object>{ 'extensions' => new List<Object>{ 'png', 'pdf' } })));
        List<String> limits = JFormUploadPolicy.configProblems(withConfig(null, new Map<String, Object>{ 'maxSizeMb' => 4, 'maxFiles' => 11 }));
        Assert.areEqual(2, limits.size(), String.valueOf(limits));
        JFormDefinition.Field text = withConfig(null, new Map<String, Object>{ 'extensions' => new List<Object>{ 'exe' } });
        text.fieldType = 'text';
        Assert.isTrue(JFormUploadPolicy.configProblems(text).isEmpty(), 'only file upload fields are checked');
    }

    @IsTest
    static void savingRefusesUnknownExtensions() {
        System.runAs(JFormTestDataFactory.builderUser()) {
            JFormDefinition.Form def = JFormTestDataFactory.sampleDefinition('Upload rules');
            def.sections[0].fields.add(withConfig(null, new Map<String, Object>{ 'extensions' => new List<Object>{ 'pdf', 'exe' } }));
            try {
                JFormDefinitionService.create(def);
                Assert.fail('an extension off the allowlist must be refused');
            } catch (JFormDefinition.JFormException e) {
                Assert.isTrue(e.getMessage().contains('cannot take files of type exe'), e.getMessage());
            }
        }
    }

    @IsTest
    static void safeFileNameKeepsOnlyAPlainName() {
        Assert.areEqual('report.pdf', JFormUploadPolicy.safeFileName('../../etc/report.pdf'));
        Assert.areEqual('report.pdf', JFormUploadPolicy.safeFileName('C:\\Users\\me\\report.pdf'));
        Assert.areEqual('a_b_.png', JFormUploadPolicy.safeFileName('a<b>.png'));
        Assert.areEqual('my photo.png', JFormUploadPolicy.safeFileName('  my   photo.png '));
        Assert.areEqual('hidden.png', JFormUploadPolicy.safeFileName('..hidden.png'));
        Assert.isNull(JFormUploadPolicy.safeFileName('...'));
        Assert.isNull(JFormUploadPolicy.safeFileName(' '));
        Assert.areEqual('The file needs a name.', JFormUploadPolicy.problemWith(uploadField(null), '/'));
    }

    @IsTest
    static void longNamesKeepTheirExtension() {
        String longName = 'a'.repeat(300) + '.pdf';
        String safeName = JFormUploadPolicy.safeFileName(longName);
        Assert.areEqual(JFormUploadPolicy.MAX_FILE_NAME_LENGTH, safeName.length());
        Assert.isTrue(safeName.endsWith('.pdf'));
    }

    @IsTest
    static void anUploadsDescriptionNamesItsField() {
        Assert.areEqual('sheet', JFormUploadPolicy.fieldKeyOf(JFormUploadPolicy.description('sheet')));
        Assert.isNull(JFormUploadPolicy.fieldKeyOf('JForm signature\nField: sheet'));
        Assert.isNull(JFormUploadPolicy.fieldKeyOf('Field: sheet'));
        Assert.isNull(JFormUploadPolicy.fieldKeyOf(null));
    }
}
