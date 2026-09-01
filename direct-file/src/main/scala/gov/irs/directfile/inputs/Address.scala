package gov.irs.directfile.inputs

import gov.irs.formbuilder.parser.{ Input, InputContext, InputParser }
import scala.jdk.CollectionConverters.SeqHasAsJava

/** One option in the state select: the code the Fact Graph stores, and the locale key naming it. */
case class StateOption(value: String, labelKey: String)

/** `<input type="address"/>` — the six fields of a Fact Graph `Address`, as one fieldset.
  *
  * `AddressFactory` takes street, city, postal code, state, an optional second street line and a country, and this is
  * the input that collects them. It renders its own label — the question becomes the fieldset's `<legend>` and each box
  * gets its own — so `suppliesOwnLabel` is true.
  *
  * ## What this is not
  *
  * Direct File's `Address.tsx` is 474 lines, and most of them are validation: street characters, the combined length of
  * the two street lines, and the APO/DPO/FPO cross-check that a city of `APO` implies a state of `AA`/`AE`/`AP` and the
  * reverse. None of that is here. What is here is the address, bound to the same fact, with the browser refusing only
  * what `AddressFactory` itself refuses. The rest is a real gap and is recorded as one in
  * `codemod/component-coverage.md` rather than being quietly implied by the type existing.
  *
  * ## The state list
  *
  * The codes come from Direct File's own `statesAndProvinces` and its `STATE_OR_PROVINCE_OPTIONS`, in that order, and
  * the labels are read out of this application's locale files by the key named here — so the list is translated the way
  * every other string on the page is, rather than being spelled out twice in the template. `AE` appears four times on
  * purpose: upstream lists Africa, Canada, Europe and the Middle East separately even though the Fact Graph stores one
  * code for all four, which is what lets someone find their posting by name.
  */
object Address extends InputParser {

  /** The country every Direct File address has: the flow never asks, and `AddressFactory` defaults to it. */
  val country = "United States of America"

  private val states: Seq[StateOption] =
    Seq(
      "AL",
      "AK",
      "AZ",
      "AR",
      "CA",
      "CO",
      "CT",
      "DE",
      "DC",
      "FL",
      "GA",
      "HI",
      "ID",
      "IL",
      "IN",
      "IA",
      "KS",
      "KY",
      "LA",
      "ME",
      "MD",
      "MA",
      "MI",
      "MN",
      "MS",
      "MO",
      "MT",
      "NE",
      "NV",
      "NH",
      "NJ",
      "NM",
      "NY",
      "NC",
      "ND",
      "OH",
      "OK",
      "OR",
      "PA",
      "RI",
      "SC",
      "SD",
      "TN",
      "TX",
      "UT",
      "VT",
      "VA",
      "WA",
      "WV",
      "WI",
      "WY",
    ).map(code => StateOption(code, s"inputs.address.states.$code")) ++ Seq(
      StateOption("AA", "inputs.address.states.armedForcesAmericas"),
      StateOption("AE", "inputs.address.states.armedForcesAfrica"),
      StateOption("AE", "inputs.address.states.armedForcesCanada"),
      StateOption("AE", "inputs.address.states.armedForcesEurope"),
      StateOption("AE", "inputs.address.states.armedForcesMiddleEast"),
      StateOption("AP", "inputs.address.states.armedForcesPacific"),
    )

  override def parse(context: InputContext): Input =
    Input.custom(
      name = "address",
      optional = context.optional,
      templateVariables = Map("states" -> states.asJava, "country" -> country),
      nodeType = Some("AddressNode"),
      suppliesOwnLabel = true,
    )
}
