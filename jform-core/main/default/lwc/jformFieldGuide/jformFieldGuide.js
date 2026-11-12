import { defaultsFor, getType } from "c/jformFieldRegistry";

/**
 * What each palette field is for, for the palette's preview card and search:
 *  - desc: one line on what the field is
 *  - when: when to pick it
 *  - compare: fields people confuse it with
 *  - words: extra search words ("country" finds Dropdown)
 *  - sample / value: an example field as respondents see it (lists: the countries an Address example needs), or note: text for fields that show nothing like an input
 */
const GUIDE = {
  text: {
    desc: "A short answer on one line.",
    when: "Names, job titles, reference numbers: anything that fits on one line.",
    compare: ["comment", "email"],
    words: "short name title single line",
    sample: { label: "Full name" },
    value: "Jordan Lee"
  },
  name: {
    desc: "A person's name in one field: first name, then last name.",
    when: "Contact, sign-up and booking forms. Each part is saved as its own answer and maps to First Name and Last Name on a contact or lead.",
    compare: ["text"],
    words: "first last full surname given family person contact",
    sample: { label: "Name" },
    value: { firstName: "Jordan", lastName: "Lee" }
  },
  email: {
    desc: "An email address, checked for a valid format before the form is sent.",
    when: "You need to reply, or match the response to a contact or lead.",
    compare: ["text", "phone"],
    words: "mail address contact",
    sample: { label: "Email" },
    value: "jordan@example.com"
  },
  phone: {
    desc: "A phone number with a country code picker.",
    when: "You need to call or text back. The number is checked for the country picked.",
    compare: ["text"],
    words: "mobile telephone sms cell number",
    sample: { label: "Mobile" }
  },
  comment: {
    desc: "A longer answer over several lines.",
    when: "Comments, descriptions or anything that needs more than a sentence.",
    compare: ["text", "richtext"],
    words: "paragraph textarea message comments long",
    sample: { label: "Anything else we should know?" },
    value: "We will arrive a little late on the first day."
  },
  number: {
    desc: "Numbers only.",
    when: "Quantities, ages or amounts you want to total or compare later.",
    compare: ["text"],
    words: "amount quantity age count",
    sample: { label: "Number of guests" },
    value: "2"
  },
  picklist: {
    desc: "One answer, picked from a list that opens on click.",
    when: "The list is long (more than about six options), like country, product or branch. The page stays short.",
    compare: ["radio", "checkboxes"],
    words: "select list country state product picklist",
    sample: { label: "Country", options: ["Australia", "New Zealand", "Singapore", "Vietnam"] }
  },
  date: {
    desc: "A date, typed or picked from a calendar.",
    when: "Birthdays, appointments or start dates.",
    compare: ["time", "event"],
    words: "birthday calendar day",
    sample: { label: "Date of birth" }
  },
  time: {
    desc: "A time of day.",
    when: "Preferred call-back or arrival times.",
    compare: ["date"],
    words: "hour clock",
    sample: { label: "Best time to call" }
  },
  fileupload: {
    desc: "People attach one or more files.",
    when: "Photos, CVs, receipts or signed documents.",
    compare: ["signature"],
    words: "attachment photo document pdf upload",
    sample: { label: "Upload your CV" }
  },
  signature: {
    desc: "People sign with a mouse, finger or pen, or type their name.",
    when: "Waivers, consent forms, declarations and sign-off. The signature is saved as an image on the response and on the record the form creates. It is a simple e-signature: it does not check who signed.",
    compare: ["consent", "fileupload"],
    words: "sign esignature e-signature autograph waiver initials sign-off",
    sample: { label: "Signature", config: { statement: "By signing, I agree to the terms above." } }
  },
  radio: {
    desc: "One answer, with every option shown at once.",
    when: "There are two to six options and people should see them all before choosing.",
    compare: ["picklist", "yesno", "checkboxes"],
    words: "radio option one single choice",
    sample: { label: "How should we contact you?", options: ["Email", "Phone call", "Text message"] },
    value: "Email"
  },
  checkboxes: {
    desc: "Any number of answers, with every option shown.",
    when: "People can tick more than one, like interests or services.",
    compare: ["radio", "picklist"],
    words: "tick multiple many several multi-select multiselect",
    sample: { label: "What are you interested in?", options: ["Product news", "Events near me", "Offers"] },
    value: ["Product news", "Events near me"]
  },
  rating: {
    desc: "A score from one to five stars.",
    when: "A quick feeling about something, like satisfaction with a visit.",
    compare: ["nps", "table"],
    words: "stars score satisfaction feedback",
    sample: { label: "How was your visit?" },
    value: "4"
  },
  table: {
    desc: "Several questions answered on one shared scale: questions in rows, answers in columns.",
    when: "Satisfaction surveys, course feedback, Likert scales, skills or availability. Each row is saved as its own answer, so you can use a row in Logic rules and map it to a record field. On phones each row becomes its own list.",
    compare: ["radio", "rating"],
    words: "matrix grid likert scale survey rows columns rate rating grid input table",
    // a drawing, not the live field: the card is narrower than a table needs, so the real one would stack its rows
    picture: {
      label: "How would you rate our",
      columns: ["Poor", "Okay", "Great"],
      rows: [
        { label: "Service", pick: "Great" },
        { label: "Prices", pick: "Okay" },
        { label: "Delivery", pick: "Great" }
      ]
    }
  },
  nps: {
    desc: "How likely someone is to recommend you, from 0 to 10.",
    when: "You track Net Promoter Score and want the standard 0 to 10 scale.",
    compare: ["rating"],
    words: "net promoter recommend score",
    sample: { label: "How likely are you to recommend us to a friend?" },
    value: "9"
  },
  yesno: {
    desc: "A quick yes or no.",
    when: "The question has exactly two answers. One tap, no list to open.",
    compare: ["radio", "consent"],
    words: "boolean true false toggle",
    sample: { label: "Have you visited us before?" },
    value: "Yes"
  },
  richtext: {
    desc: "Formatted text that asks nothing.",
    when: "Instructions, terms or a welcome message between questions.",
    compare: ["heading"],
    words: "instructions paragraph terms text",
    sample: { richtext: "<p><strong>Before you start</strong></p><p>Have your booking number ready. It takes about three minutes.</p>" }
  },
  heading: {
    desc: "A title that splits a page into parts.",
    when: "Long pages: headings help people see where they are.",
    compare: ["divider", "richtext"],
    words: "title section",
    sample: { label: "Your details", helpText: "We use these to confirm your booking." }
  },
  divider: {
    desc: "A thin line between groups of fields.",
    when: "Separating groups without adding words.",
    compare: ["heading"],
    words: "line separator"
  },
  image: {
    desc: "A picture on the form.",
    when: "Logos, maps, product photos or diagrams people need to see.",
    compare: [],
    words: "logo picture photo",
    note: "Shows the picture you add, at the size you choose."
  },
  event: {
    desc: "An event's date, time and place, shown as a card.",
    when: "Registration forms: people see what they are signing up for.",
    compare: ["date"],
    words: "location venue registration",
    sample: { label: "Summer open day", config: { startTime: "10:00", endTime: "14:00", location: "Main campus, Building A" } }
  },
  address: {
    desc: "A postal address in one field: country, street, city, state or province, and postal code.",
    when: "Sign-ups, orders and bookings. Set it to Billing or Shipping for the browser's autofill. Each part is saved as its own answer and the whole address maps to a contact's Mailing Address, a lead's Address or an account's Billing or Shipping Address.",
    compare: ["text"],
    words: "street city postcode zip postal country state province mailing billing shipping delivery location",
    sample: { label: "Address", config: { defaultCountry: "AU" } },
    value: { country: "AU", street: "1 George St", city: "Sydney", state: "NSW", postalCode: "2000" },
    // just enough of the org's lists for the example to show names
    lists: { countries: [{ code: "AU", name: "Australia", states: [{ code: "NSW", name: "New South Wales" }] }] }
  },
  hidden: {
    desc: "A value saved with each response that people never see.",
    when: "Tracking where people came from. It is filled from the form link.",
    compare: [],
    words: "utm campaign source url parameter tracking",
    note: "Nothing shows on the form. The value comes from the form link: a field with the key source saves “newsletter” from a link ending in ?source=newsletter."
  },
  consent: {
    desc: "A checkbox people tick to agree.",
    when: "Terms, privacy or permission to contact. Make it required to block sending without it.",
    compare: ["checkboxes", "yesno", "signature"],
    words: "agree terms privacy gdpr permission",
    sample: { label: "I agree to the terms and to being contacted about my booking.", required: true }
  },
  payment: {
    desc: "Takes a card payment through your Stripe account before the response is sent.",
    when: "Tickets, fees, orders and donations. The price can be fixed, follow a choice or a quantity, or be what people want to pay.",
    compare: ["number"],
    words: "pay stripe price card checkout ticket fee donation order money",
    note: "Shows the total on the form; the button reads “Pay $40 and submit” and opens Stripe's checkout. One per form. Set up Stripe on the JForm Setup tab first."
  }
};

const EMPTY = { desc: "", when: "", compare: [], words: "" };

export function guideFor(type) {
  return GUIDE[type] || EMPTY;
}

/** Everything search looks at for a field type, lower case. */
export function searchText(type) {
  const t = getType(type);
  const g = guideFor(type);
  return [type, t.label, t.short, g.desc, g.when, g.words].filter(Boolean).join(" ").toLowerCase();
}

/**
 * The example shown in the preview card: { field, value, addressLists } for c-jform-field, { note } for fields
 * that show nothing like an input, or { picture } for a table, drawn by the card. Starts from the
 * builder's defaults so new field settings carry over.
 */
export function sampleOf(type) {
  const g = guideFor(type);
  if (g.note) return { note: g.note };
  if (g.picture) return { picture: g.picture };
  const base = defaultsFor(type);
  const sample = g.sample || {};
  const field = { ...base, ...sample, key: `sample_${type}`, config: { ...(base.config || {}), ...(sample.config || {}) } };
  if (sample.options) field.options = sample.options.map((label) => ({ label, value: label }));
  return { field, value: g.value, addressLists: g.lists };
}
