# Resources for building TWE

Everything the site generator reads from disk lives here: the fact dictionary (`facts/`), the flow
(`flow/`), the locale YAML (`locales/`), this app's Thymeleaf overrides (`templates/`), and the
static files copied verbatim into the built site (`website-static/`). The generator reads these from
the source tree rather than the classpath, so an edit takes effect on the next `sbt run` with no
resource copy in between.

`package.json`, `eslint.config.js` and `htmlvalidate.json` pin the tools that lint the JavaScript and
validate the generated HTML, plus the `pdf-lib` release the vendored bundle under
`website-static/vendor/` tracks. The Node environment sits down here rather than at the repository
root because Node is not required to build the site, only to run the checks.

Its scripts back three targets in the app's `Makefile`: `npm run lint` is `make validate-js`,
`npm run format` is part of `make format`, and `npm run html-validate` is `make validate-html`.
