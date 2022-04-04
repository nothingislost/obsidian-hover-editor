module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: "module",
    project: ["tsconfig.json", ".eslintrc.js"],
    tsconfigRootDir: __dirname,
  },
  extends: [
    "plugin:import/typescript",
    "eslint:recommended",
    "plugin:prettier/recommended",  
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier"
  ],
  env: {
    browser: true,
    node: true,
  },
  plugins: [
    "@typescript-eslint",
  ],
  settings: {
    "import/parsers": {
      "@typescript-eslint/parser": [".ts", ".tsx"],
    },
  },
  rules: {
    "no-unused-vars": "off",
    "max-len": [
      "error",
      120,
      2,
      {
        ignoreUrls: true,
        ignoreComments: true,
        ignoreRegExpLiterals: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
      },
    ],
    "react/jsx-filename-extension": "off",
    "import/no-extraneous-dependencies": "off",
    "import/no-unresolved": "off",
    "linebreak-style": ["error", "unix"],
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/ban-types": [
      "error",
      {
        types: {
          Function: false,
        },
        extendDefaults: true,
      },
    ],
    "comma-dangle": ["error", "only-multiline"],
    "arrow-parens": ["error", "as-needed"],
    "no-empty": ["error", { allowEmptyCatch: true }],
    "@typescript-eslint/no-this-alias": [
      "error",
      {
        allowedNames: ["self", "plugin"],
      },
    ],
    "no-prototype-builtins": "off",
    "function-paren-newline": "off",
    "@typescript-eslint/no-empty-function": "off",
  },
  overrides: [
    {
      files: ["*.ts"],
      rules: {
        "no-undef": "off",
        "no-extra-parens": "off",
        "@typescript-eslint/no-extra-parens": "off",
      },
    },
  ],
};
