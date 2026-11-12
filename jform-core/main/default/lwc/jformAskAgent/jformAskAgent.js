import { LightningElement, api } from "lwc";

const HIDDEN_KEY = "jform.askAgent.hidden";

/**
 * "Ask Agentforce" starter prompts for the JForm home (workspace picker).
 * Lightning has no supported API to type into the Agentforce panel, so each
 * prompt has a Copy button and the footer says where to paste it.
 */
export default class JformAskAgent extends LightningElement {
  /** Name of the most recently changed form, used to make the prompts concrete. */
  @api latestFormName;

  hidden = false;
  copiedIndex = -1;
  copyTimer;

  connectedCallback() {
    try {
      this.hidden = window.localStorage.getItem(HIDDEN_KEY) === "1";
    } catch (e) {
      this.hidden = false;
    }
  }

  disconnectedCallback() {
    clearTimeout(this.copyTimer);
  }

  get prompts() {
    const name = this.latestFormName ? `"${this.latestFormName}"` : "our latest Summer form";
    const texts = [
      `Build a form like ${name} and call it "Autumn Clinic 2026". Show me the outline.`,
      'Create a booking request form with name, email, preferred date and a "Store" dropdown with London and Leeds. Make email required. (For a new form you can also use New form → Describe it.)',
      'In that form, only ask for a number plate when "How will you get here?" is Driving. Then publish it.',
      `How many responses did ${name} get, and what were the most popular answers?`
    ];
    return texts.map((text, i) => ({
      key: `p${i}`,
      index: i,
      text,
      copied: i === this.copiedIndex,
      buttonLabel: i === this.copiedIndex ? "Copied" : "Copy prompt",
      buttonIcon: i === this.copiedIndex ? "utility:check" : "utility:copy"
    }));
  }

  async handleCopy(event) {
    const index = Number(event.currentTarget.dataset.index);
    const text = this.prompts[index].text;
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      /* clipboard unavailable: the prompt text is selectable */
    }
    this.copiedIndex = index;
    clearTimeout(this.copyTimer);
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this.copyTimer = setTimeout(() => {
      this.copiedIndex = -1;
    }, 2000);
  }

  handleHide() {
    this.setHidden(true);
  }

  handleShow() {
    this.setHidden(false);
  }

  setHidden(value) {
    this.hidden = value;
    try {
      if (value) {
        window.localStorage.setItem(HIDDEN_KEY, "1");
      } else {
        window.localStorage.removeItem(HIDDEN_KEY);
      }
    } catch (e) {
      /* storage blocked: the choice lasts for this page view */
    }
  }
}
