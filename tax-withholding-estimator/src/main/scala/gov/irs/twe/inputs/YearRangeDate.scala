package gov.irs.twe.inputs

import gov.irs.factgraph.{ FactDictionary, Path }
import gov.irs.formbuilder.exceptions.InvalidFormConfig
import gov.irs.formbuilder.parser.{ Input, InputContext, InputParser }

/** `<input type="date" previous-years="1"/>` — the scaffold's date input, with the free-text year replaced by a select
  * over a window around the tax year.
  *
  * This is registered under `"date"`, not under a new name: [[gov.irs.formbuilder.FormBuilderApp.inputTypes]] is merged
  * *over* the built-ins, so registering an existing name reshapes that input rather than adding a second one. The
  * template that renders it is TWE's own `nodes/inputs/date.html`, which wins by the same app-first resolution.
  *
  * The years come out as numbers, not strings, because the template counts off them (`#numbers.sequence(previousYears,
  * 1)`, `taxYearNumber - offset`).
  */
object YearRangeDate extends InputParser {
  override def parse(context: InputContext): Input = {
    val previousYears = yearCount(context, "previous-years")
    val futureYears = yearCount(context, "future-years")
    val taxYear = literalFactValue(context.factDictionary, "/taxYear")

    Input.custom(
      name = "date",
      optional = context.optional,
      templateVariables = Map(
        "taxYear" -> taxYear,
        "taxYearNumber" -> Int.box(taxYear.toInt),
        "previousYears" -> Int.box(previousYears),
        "futureYears" -> Int.box(futureYears),
      ),
      nodeType = Some("DayNode"),
      suppliesOwnLabel = true,
    )
  }

  private def yearCount(context: InputContext, attribute: String): Int = {
    val raw = context.inputNode \@ attribute
    if (raw.isEmpty) return 0

    raw.toIntOption.filter(_ >= 0).getOrElse {
      throw InvalidFormConfig(
        s"Date input $attribute must be a non-negative integer, got '$raw' at path ${context.path}",
      )
    }
  }

  /** The literal the fact dictionary declares for a constant, so the year select can be centred on the tax year without
    * anyone having to repeat it in the flow XML.
    */
  private def literalFactValue(factDictionary: FactDictionary, path: String): String = {
    val factNode = factDictionary.getDefinitionsAsNodes()(Path(path))
    val intValue = (factNode \ "Derived" \ "Int").text.trim
    val taxYearValue = (factNode \ "TaxYear").text.trim

    Option
      .when(intValue.nonEmpty)(intValue)
      .orElse(Option.when(taxYearValue.nonEmpty)(taxYearValue))
      .getOrElse(throw InvalidFormConfig(s"Fact $path must contain a literal value"))
  }
}
