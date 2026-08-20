package gov.irs.twe.inputs

import gov.irs.formbuilder.parser.{ Input, InputContext, InputParser }

/** `<input type="single-checkbox"/>` — one boolean rendered as a lone checkbox with the question as its label.
  *
  * The scaffold has no such input, and does not need one: this is 8 lines and a template, registered in
  * [[gov.irs.twe.app]]'s `inputTypes`. It binds to a `BooleanNode` like the built-in boolean does, and it renders its
  * own label, so `fg-set` must not put one in front of it.
  */
object SingleCheckbox extends InputParser {
  override def parse(context: InputContext): Input =
    Input.custom(
      name = "single-checkbox",
      optional = context.optional,
      nodeType = Some("BooleanNode"),
      suppliesOwnLabel = true,
    )
}
