package gov.irs.directfile

import gov.irs.directfile.inputs.{ Address, BankAccount, MaskedNumber }
import gov.irs.formbuilder.{ FormBuilder, FormBuilderApp }
import scala.collection.immutable.ListMap

/** Direct File, expressed as configuration over `gov.irs::form-builder`.
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
  appId = "direct-file",
  basePath = "/app/direct-file",
  outSubdir = "app/direct-file",
  // Insertion-ordered: the first entry is the default language, generated at the site root, and
  // every other one gets its own path segment underneath it.
  locales = ListMap(
    "en" -> "English",
    "es" -> "Español",
  ),
  defaultPort = 3008,
  brand = "Direct File",
  // Namespaces every browser storage key this site writes, so this app and any other Form Builder app
  // served from the same origin do not rehydrate each other's fact graph out of one sessionStorage.
  // The scaffold renders it into every page's <head>, whether or not the workspace is built in.
  storagePrefix = Some("direct-file"),

  // The seven Fact Graph types the scaffold's built-in inputs do not cover. Each name selects three
  // things that have to agree: the parser below, `templates/nodes/inputs/{name}.html`, and the
  // handlers registered under it in `website-static/js/inputs/`.
  //
  // Seven and not the eight the porting plan listed. `fact-select` is not here, and its absence is
  // the finding rather than an omission: what makes Direct File's FactSelect a component is the
  // *amount* it collects beside the code, at a path assembled from the chosen code
  // (`/formW2s/*/{code}`) — a path the Flow XML has no way to name. What is left once that is taken
  // out is an enum rendered as a dropdown, which is the built-in `<select>`. Registering a type
  // that only renamed a built-in would claim the gap was closed. See codemod/component-coverage.md.
  //
  // `nodeTypes` stays empty: Direct File's flow needs no element the scaffold has never heard of.
  inputTypes = MaskedNumber.all ++ Map(
    "address" -> Address,
    "bank-account" -> BankAccount,
  ),
)

@main def main(args: String*): Unit = FormBuilder.run(app, args)
