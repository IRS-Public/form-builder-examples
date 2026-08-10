package gov.irs.twe

import gov.irs.formative.{ Formative, FormativeApp }
import gov.irs.twe.inputs.{ SingleCheckbox, YearRangeDate }
import gov.irs.twe.parser.FgWithholdingAdjustments
import scala.collection.immutable.ListMap

/** The Tax Withholding Estimator, expressed as configuration over `gov.irs::formative`.
  *
  * This app used to carry its own copy of the whole generator — 28 Scala files, 23 of which shared a basename with
  * credit-assistant's and most of which differed only by their package line. All of that is the scaffold's now. What is
  * left is the three things the two forks actually disagreed about, and they are the three registrations below.
  */
val app: FormativeApp = FormativeApp(
  appId = "twe",
  basePath = "/app/tax-withholding-estimator",
  outSubdir = "app/tax-withholding-estimator",
  locales = ListMap("en" -> "English", "es" -> "Español"),
  defaultPort = 3000,
  brand = "Tax Withholding Estimator",

  // A flow element the scaffold has never heard of: the W-4 / W-4P adjustment table. Its parser is 50 lines here,
  // and its two templates sit in this app's resources, where app-first resolution finds them.
  nodeTypes = Map("fg-withholding-adjustments" -> FgWithholdingAdjustments),

  // One input the scaffold does not ship, and one it does that this app wants a different shape of. Registering an
  // existing name replaces the built-in rather than adding a second one — see FormativeApp.inputTypes.
  inputTypes = Map(
    "single-checkbox" -> SingleCheckbox,
    "date" -> YearRangeDate,
  ),
)

@main def main(args: String*): Unit = Formative.run(app, args)
