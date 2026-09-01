import globals from 'globals'
import { defineConfig, globalIgnores } from 'eslint/config'
import neostandard from 'neostandard'
import security from 'eslint-plugin-security'

export default defineConfig([
  // The vendored trees are generated mirrors of other packages — linting them would report other
  // people's style, and `make copy-shared-ui` / `make copy-uswds` overwrite any fix anyway.
  globalIgnores(['./website-static/vendor/*']),
  ...neostandard(),
  security.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        // Set by the flow runtime once the fact graph has booted.
        factGraph: 'writable'
      },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'error',
      'no-implicit-globals': 'error',
      eqeqeq: 'error',
    },
  },
])
