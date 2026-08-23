package gov.irs.benefitsenrollment

import gov.irs.formbuilder.{ FormBuilder, FormBuilderApp }
import scala.collection.immutable.ListMap

/** Benefits Enrollment, expressed as configuration over `gov.irs::form-builder`.
  *
  * This is the whole Scala surface of the application. The flow parser, the generators, the Thymeleaf engine, the node
  * templates, the chrome locales and Author Mode all belong to the scaffold; what lives in this repository is the
  * domain — the flow XML, the fact dictionary, the locale YAML, the brand CSS, and the fact-graph registration under
  * `website-static/js/taxpert/`.
  *
  * `appId`, the URL segment and the sbt project name are deliberately independent, even though the template set all
  * three from one answer. Changing one later does not force the others.
  */
val app: FormBuilderApp = FormBuilderApp(
  appId = "benefits-enrollment",
  basePath = "/app/benefits",
  outSubdir = "app/benefits",
  // Insertion-ordered: the first entry is the default language, generated at the site root, and
  // every other one gets its own path segment underneath it.
  locales = ListMap(
    "en" -> "English",
  ),
  defaultPort = 3006,
  brand = "Benefits Enrollment",
  // Namespaces every browser storage key this site writes, so this app and any other Form Builder app
  // served from the same origin do not rehydrate each other's fact graph out of one sessionStorage.
  // The scaffold renders it into every page's <head>, whether or not the workspace is built in.
  storagePrefix = Some("benefits-enrollment"),

  // Two extension points are left empty here, and both take a registration rather than a fork:
  //
  //   nodeTypes  = Map("fg-my-element" -> MyParser)   a flow element the scaffold has never heard of
  //   inputTypes = Map("my-input" -> MyInputParser)   a new input, or a replacement for a built-in
  //
  // A custom node's Thymeleaf template goes in this app's own `templates/nodes/`, where app-first
  // resolution finds it ahead of the library's. See tax-withholding-estimator for a worked example
  // of each.
)

@main def main(args: String*): Unit = FormBuilder.run(app, args)
