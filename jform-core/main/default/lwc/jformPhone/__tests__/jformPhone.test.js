import {
  COUNTRIES, OTHER, detectCountry, startCountry, localeCountry, cleanNumber, formatTyping, toAnswer, readAnswer, examplePlaceholder, phoneProblem
} from "c/jformPhone";

describe("c/jformPhone countries", () => {
  it("offers the generated list by name, each with its calling code", () => {
    expect(COUNTRIES).toHaveLength(50);
    expect(COUNTRIES[0]).toEqual({ iso: "AR", name: "Argentina", dial: "54", flag: 0 });
    expect(COUNTRIES.find((c) => c.iso === "VN").dial).toBe("84");
  });
});

describe("c/jformPhone country detection", () => {
  it("trusts the time zone first, old zone names included", () => {
    expect(detectCountry({ timeZone: "Asia/Ho_Chi_Minh", languages: ["en-US"] })).toBe("VN");
    expect(detectCountry({ timeZone: "Asia/Saigon" })).toBe("VN");
    expect(detectCountry({ timeZone: "Asia/Calcutta" })).toBe("IN");
    expect(detectCountry({ timeZone: "Australia/Sydney", languages: ["vi-VN"] })).toBe("AU");
  });

  it("falls back to the browser's languages, then gives up", () => {
    expect(detectCountry({ timeZone: "Europe/Moscow", languages: ["ru-RU", "en-GB"] })).toBe("GB");
    expect(detectCountry({ timeZone: "UTC", languages: ["vi"] })).toBe("VN");
    expect(detectCountry({ timeZone: "UTC", languages: ["ru", "en"] })).toBeNull();
  });

  it("starts in the visitor's country only where the field allows it", () => {
    const tokyo = { timeZone: "Asia/Tokyo" };
    expect(startCountry({ defaultCountry: "AU", detectCountry: true }, true, tokyo)).toBe("JP");
    expect(startCountry({ defaultCountry: "AU", detectCountry: true }, false, tokyo)).toBe("AU"); // the builder canvas
    expect(startCountry({ defaultCountry: "AU" }, true, tokyo)).toBe("AU");
    expect(startCountry({ defaultCountry: "AU", detectCountry: true }, true, { timeZone: "UTC" })).toBe("AU");
    expect(startCountry({}, false)).toBe("US");
  });

  it("reads the builder's country from a locale", () => {
    expect(localeCountry("en-AU")).toBe("AU");
    expect(localeCountry("vi_VN")).toBe("VN");
    expect(localeCountry("ru-RU")).toBe("US");
  });
});

describe("c/jformPhone numbers", () => {
  it("stores international format and shows the national one", () => {
    expect(cleanNumber(" (091) 234-5678 ")).toBe("0912345678");
    expect(cleanNumber("+84 91")).toBe("+8491");
    expect(formatTyping("0912345678", "VN")).toBe("0912 345 678");
    expect(toAnswer("0912 345 678", "VN")).toBe("+84912345678");
    expect(toAnswer("0412 345 678", "AU")).toBe("+61412345678");
    expect(toAnswer("06 1234 5678", "IT")).toBe("+390612345678"); // Italian landlines keep their 0
    expect(toAnswer("+61 412 345 678", "VN")).toBe("+61412345678"); // a typed code wins
    expect(toAnswer("977 1 4123456", OTHER)).toBe("+97714123456");
    expect(toAnswer("", "VN")).toBe("");
    expect(toAnswer("+", OTHER)).toBe("");
  });

  it("reads a stored answer back into its country", () => {
    expect(readAnswer("+84912345678", "US")).toEqual({ iso: "VN", text: "0912 345 678" });
    expect(readAnswer("+14165550123", "US").iso).toBe("CA");
    expect(readAnswer("+9771234567", "US")).toEqual({ iso: OTHER, text: "+9771234567" });
    expect(readAnswer("0412345678", "AU")).toEqual({ iso: "AU", text: "0412 345 678" });
    expect(readAnswer("", "AU")).toEqual({ iso: "AU", text: "" });
  });

  it("offers a sample number as the placeholder", () => {
    expect(examplePlaceholder("VN")).toBe("0912 345 678");
    expect(examplePlaceholder("AU")).toBe("0412 345 678");
    expect(examplePlaceholder(OTHER)).toMatch(/^\+/);
  });
});

describe("c/jformPhone checks", () => {
  it("checks the length for the number's country", () => {
    expect(phoneProblem("+84912345678", {})).toBeNull();
    expect(phoneProblem("+8491234", {})).toBe("This number is too short for Vietnam.");
    expect(phoneProblem("+849123456789012", {})).toBe("This number is too long for Vietnam.");
    expect(phoneProblem("", {})).toBeNull();
    expect(phoneProblem("0912345678", {})).toBe("Enter the number with its country code.");
  });

  it("checks number ranges only with the strict check", () => {
    expect(phoneProblem("+84112345678", {})).toBeNull(); // the right length
    expect(phoneProblem("+84112345678", { strictNumber: true })).toBe("Enter a valid phone number for Vietnam.");
    expect(phoneProblem("+84912345678", { strictNumber: true })).toBeNull();
  });

  it("accepts mobiles only when asked, and any valid US or Canadian number", () => {
    expect(phoneProblem("+842838123456", { mobileOnly: true })).toBe("Enter a mobile number.");
    expect(phoneProblem("+84912345678", { mobileOnly: true })).toBeNull();
    expect(phoneProblem("+12015550123", { mobileOnly: true })).toBeNull();
    expect(phoneProblem("+84112345678", { mobileOnly: true })).toBe("Enter a valid phone number for Vietnam.");
  });

  it("checks only the shape of numbers from other countries", () => {
    expect(phoneProblem("+9771234567", { strictNumber: true })).toBeNull();
    expect(phoneProblem("+97712", {})).toBe("Enter the full number, starting with + and the country code.");
    expect(phoneProblem("+9771234567890123", {})).toBe("Enter the full number, starting with + and the country code.");
  });
});
