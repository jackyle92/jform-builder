/**
 * The Design tab's styles for Apex (the agent's Apply Design action and the outline), plus the
 * colour checks the Design tab shows. Keep STYLES in step with PRESETS in c/jformDesignTab.
 */
public with sharing class JFormDesignPresets {

    public static final String SINGLE_PAGE = 'Single Page';
    public static final String PAGED = 'Multi-Page (Sections)';
    /** Text on a coloured button, and a main colour against the card, must reach these WCAG ratios. */
    public static final Decimal TEXT_CONTRAST = 4.5;
    public static final Decimal SHAPE_CONTRAST = 3.0;
    private static final String DARK_TEXT = '#181818';

    public class Style {
        public String id;
        public String label;
        public String mood;
        public Map<String, String> tokens;
        Style(String id, String label, String mood, Map<String, String> tokens) {
            this.id = id;
            this.label = label;
            this.mood = mood;
            this.tokens = tokens;
        }
    }

    /** Ordered as on the Design tab; token keys are the theme JSON keys. */
    public static final List<Style> STYLES = new List<Style>{
        new Style('card', 'Card', 'clean and neutral, the default', tokens('#337418', '#f8f8f8', '#ffffff', '#0f0f0f', '', 'system', 'soft', 'outline', 'cards', 'filled')),
        new Style('minimal', 'Minimal', 'plain, with underlined fields', tokens('#181818', '#ffffff', '#ffffff', '#181818', '', 'system', 'square', 'underline', 'list', 'outline')),
        new Style('teal', 'Teal', 'calm, with serif headings', tokens('#0f766e', '#f1f5f4', '#ffffff', '#1c2321', '', 'serif', 'round', 'outline', 'cards', 'filled')),
        new Style('dark', 'Dark', 'dark background', tokens('#5dd62c', '#0f0f0f', '#202020', '#f8f8f8', '', 'system', 'soft', 'filled', 'cards', 'filled')),
        new Style('warm', 'Warm', 'friendly orange tones', tokens('#c2410c', '#fff7ed', '#ffffff', '#7c2d12', '', 'serif', 'round', 'filled', 'cards', 'filled')),
        new Style('corporate', 'Corporate', 'formal blue', tokens('#2a5bd7', '#eef4ff', '#ffffff', '#0b2a66', '#334155', 'system', 'square', 'outline', 'list', 'filled')),
        new Style('drift', 'Drift', 'a soft colour mesh behind a frosted card, with pill buttons',
            shadow(finish(tokens('#5b3df5', '#f6f5fb', '#ffffff', '#14122b', '', 'system', 'round', 'outline', 'cards', 'filled'), 'mesh', 'glass', 'pill', 'segments', 'spotlight'), 60, 24, 24))
    };

    /** Page and card finish keys (the renderer's backgroundStyle and the rest); every style sets them, only Drift away from plain, except progressStyle: that is layout, which only Drift sets. The plain values in tokens() match FINISH_DEFAULTS in c/jformTheme. */
    private static final List<String> FINISH_KEYS = new List<String>{ 'backgroundStyle', 'surfaceStyle', 'buttonShape', 'progressStyle', 'focusStyle', 'shadowBlur', 'shadowDistance', 'shadowStrength', 'shadowColor' };

    private static Map<String, String> tokens(String primary, String background, String surface, String text, String labelColor,
            String headingFont, String radius, String fieldStyle, String choiceStyle, String buttonStyle) {
        return new Map<String, String>{
            'primary' => primary, 'background' => background, 'surface' => surface, 'text' => text, 'labelColor' => labelColor,
            'headingFont' => headingFont, 'radius' => radius, 'fieldStyle' => fieldStyle, 'choiceStyle' => choiceStyle, 'buttonStyle' => buttonStyle,
            'backgroundStyle' => 'solid', 'surfaceStyle' => 'solid', 'buttonShape' => 'corners', 'focusStyle' => 'none',
            'shadowBlur' => '2', 'shadowDistance' => '1', 'shadowStrength' => '4', 'shadowColor' => ''
        };
    }

    private static Map<String, String> finish(Map<String, String> k, String background, String surface, String buttonShape, String progress, String focus) {
        k.put('backgroundStyle', background);
        k.put('surfaceStyle', surface);
        k.put('buttonShape', buttonShape);
        k.put('progressStyle', progress);
        k.put('focusStyle', focus);
        return k;
    }

    /** The form card's shadow: blur and distance in px, strength as a percent opacity. */
    private static Map<String, String> shadow(Map<String, String> k, Integer blur, Integer distance, Integer strength) {
        k.put('shadowBlur', String.valueOf(blur));
        k.put('shadowDistance', String.valueOf(distance));
        k.put('shadowStrength', String.valueOf(strength));
        return k;
    }

    public static Style find(String name) {
        String n = name == null ? '' : name.trim().toLowerCase();
        for (Style s : STYLES) {
            if (s.id == n || s.label.toLowerCase() == n) {
                return s;
            }
        }
        return null;
    }

    public static String styleNames() {
        List<String> names = new List<String>();
        for (Style s : STYLES) {
            names.add(s.label);
        }
        return String.join(names, ', ');
    }

    /** Puts a style's tokens on the theme; logo, cover, width and every other setting stay. */
    public static void apply(JFormDefinition.Theme t, Style s) {
        Map<String, String> k = s.tokens;
        t.preset = s.id;
        t.primaryColor = k.get('primary');
        t.background = k.get('background');
        t.surface = k.get('surface');
        t.textColor = k.get('text');
        t.headingFont = k.get('headingFont');
        t.radius = k.get('radius');
        t.buttonStyle = k.get('buttonStyle');
        t.extra.put('labelColor', k.get('labelColor'));
        t.extra.put('fieldStyle', k.get('fieldStyle'));
        t.extra.put('choiceStyle', k.get('choiceStyle'));
        for (String key : FINISH_KEYS) {
            if (k.containsKey(key)) t.extra.put(key, k.get(key));
        }
    }

    // ------------------------------------------------------------ describing a design

    /** "Teal style, main colour #0f766e, one page per section" for the outline and the action result. */
    public static String describe(JFormDefinition.Form def) {
        JFormDefinition.Theme t = def.theme;
        Style s = find(t == null ? null : t.preset);
        String styleText = s == null ? (t == null || String.isBlank(t.preset) ? 'Card style (default)' : 'custom style') : s.label + ' style';
        String primary = t != null && String.isNotBlank(t.primaryColor) ? t.primaryColor : STYLES[0].tokens.get('primary');
        Boolean paged = def.displayStyle == PAGED || (String.isBlank(def.displayStyle) && def.sections != null && def.sections.size() > 1);
        return styleText + ', main colour ' + primary + ', ' + (paged ? 'one page per section' : 'one long page');
    }

    /** "one long page" or "one page per section" (and close wordings) as the Display Style value; null when unclear. */
    public static String layoutValue(String text) {
        String t = text == null ? '' : text.trim().toLowerCase();
        if (t.contains('per section') || t.contains('per page') || t.contains('multi') || t.contains('step') || t == 'pages' || t == 'paged') {
            return PAGED;
        }
        if (t.contains('long') || t.contains('single') || t == 'one page' || t.contains('all on one')) {
            return SINGLE_PAGE;
        }
        return null;
    }

    // ------------------------------------------------------------ colour checks (as c/jformTheme)

    /** "#2A5BD7", "2a5bd7" or "#25d" as "#2a5bd7"; null when it is not a hex colour. */
    public static String normalizeHex(String value) {
        String v = value == null ? '' : value.trim().toLowerCase().removeStart('#');
        if (v.length() == 3 && v.isAlphanumeric()) {
            v = v.substring(0, 1) + v.substring(0, 1) + v.substring(1, 2) + v.substring(1, 2) + v.substring(2, 3) + v.substring(2, 3);
        }
        return Pattern.matches('[0-9a-f]{6}', v) ? '#' + v : null;
    }

    public static Decimal contrast(String a, String b) {
        Double la = luminance(a);
        Double lb = luminance(b);
        Double ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
        return Decimal.valueOf(ratio).setScale(1, RoundingMode.DOWN);
    }

    /** White or near-black, whichever reads better on the colour: what the renderer puts on buttons. */
    public static String onColor(String hex) {
        return contrast(hex, '#ffffff') >= contrast(hex, DARK_TEXT) ? '#ffffff' : DARK_TEXT;
    }

    /**
     * Why a main colour would be hard to read with this theme, or null. Filled buttons need their text
     * readable on the colour; outline buttons need the colour readable on the card; selected choices
     * and focus rings need the colour to stand out from the card.
     */
    public static String colourProblem(String primary, JFormDefinition.Theme t) {
        String surface = t != null && String.isNotBlank(t.surface) ? t.surface : '#ffffff';
        Boolean outline = t != null && t.buttonStyle == 'outline';
        Decimal shape = contrast(primary, surface);
        Decimal text = outline ? shape : contrast(onColor(primary), primary);
        if (text < TEXT_CONTRAST) {
            return (outline ? 'Button text in ' + primary + ' on the card' : 'Button text on ' + primary) + ' has a contrast of ' + text + ':1; it needs ' + TEXT_CONTRAST + ':1.';
        }
        if (shape < SHAPE_CONTRAST) {
            return primary + ' stands out too little from the card (' + shape + ':1; it needs ' + SHAPE_CONTRAST + ':1), so selected choices would be hard to see.';
        }
        return null;
    }

    /** The nearest shade of the colour that passes colourProblem: darker on a light card, lighter on a dark one. */
    public static String readableShade(String primary, JFormDefinition.Theme t) {
        String surface = t != null && String.isNotBlank(t.surface) ? t.surface : '#ffffff';
        String toward = luminance(surface) > 0.5 ? '#000000' : '#ffffff';
        for (Integer step = 1; step <= 20; step++) {
            String shade = mix(primary, toward, step / 20.0);
            if (colourProblem(shade, t) == null) {
                return shade;
            }
        }
        return null;
    }

    private static String mix(String a, String b, Decimal share) {
        String out = '#';
        for (Integer i = 1; i <= 5; i += 2) {
            Integer x = hexByte(a.substring(i, i + 2));
            Integer y = hexByte(b.substring(i, i + 2));
            Decimal value = x + (y - x) * share;
            out += toHex(value.round(System.RoundingMode.HALF_UP).intValue());
        }
        return out;
    }

    private static Double luminance(String hex) {
        Double total = 0;
        List<Double> weights = new List<Double>{ 0.2126, 0.7152, 0.0722 };
        for (Integer i = 0; i < 3; i++) {
            Double c = Double.valueOf(hexByte(hex.substring(1 + i * 2, 3 + i * 2))) / 255;
            Double linear = c <= 0.03928d ? c / 12.92d : Math.pow((c + 0.055d) / 1.055d, 2.4d);
            total += weights[i] * linear;
        }
        return total;
    }

    private static final String HEX = '0123456789abcdef';
    private static Integer hexByte(String pair) {
        return HEX.indexOf(pair.substring(0, 1)) * 16 + HEX.indexOf(pair.substring(1, 2));
    }
    private static String toHex(Integer v) {
        Integer n = Math.max(0, Math.min(255, v));
        return HEX.substring(n / 16, n / 16 + 1) + HEX.substring(Math.mod(n, 16), Math.mod(n, 16) + 1);
    }
}
