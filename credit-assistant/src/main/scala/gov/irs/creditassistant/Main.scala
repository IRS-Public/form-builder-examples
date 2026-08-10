package gov.irs.creditassistant

import gov.irs.formative.{ Formative, FormativeApp }
import scala.collection.immutable.ListMap

/** Credit Assistant, expressed as configuration over `gov.irs::formative`.
  *
  * Everything that used to live in this package — the flow parser, the generators, the Thymeleaf engine, the node
  * templates, the chrome locales, Author Mode — is the scaffold's now, because none of it was ever about the EITC. What
  * remains here is the domain: the flow and fact XML, this app's own locale strings, its brand CSS and its fact-graph
  * registration. Plus these thirty lines.
  *
  * Note that `appId`, the URL segment and the sbt project name are deliberately allowed to differ — this app is the
  * proof that they are three independent names: it lives in `credit-assistant/`, keeps its resources under
  * `credit-assistant/`, and serves from `/app/eitc`.
  */
val app: FormativeApp = FormativeApp(
  appId = "credit-assistant",
  basePath = "/app/eitc",
  outSubdir = "app/eitc",
  // Insertion-ordered: the first entry is the default language, generated at the site root, and
  // every other one gets its own path segment underneath it.
  locales = ListMap(
    "en" -> "English",
    "es" -> "Español",
    "ht" -> "Kreyòl ayisyen",
    "ko" -> "한국어",
    "ru" -> "Русский",
    "vi" -> "Tiếng Việt",
    "zh-hans" -> "简体中文",
    "zh-hant" -> "繁體中文",
  ),
  defaultPort = 3002,
  brand = "Credit Assistant",
)

@main def main(args: String*): Unit = Formative.run(app, args)
