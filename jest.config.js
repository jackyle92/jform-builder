const { jestConfig } = require("@salesforce/sfdx-lwc-jest/config");

module.exports = {
  ...jestConfig,
  // CSS-only modules have no .js for the default resolver to find
  moduleNameMapper: {
    ...(jestConfig.moduleNameMapper || {}),
    "^c/jformBrand$": "<rootDir>/jform-core/main/default/lwc/jformBrand/jformBrand.css"
  },
  modulePathIgnorePatterns: ["<rootDir>/.localdevserver", "<rootDir>/mcp/", "<rootDir>/scripts/phone/"],
  testPathIgnorePatterns: ["/node_modules/", "/mcp/", "/scripts/phone/"]
};
