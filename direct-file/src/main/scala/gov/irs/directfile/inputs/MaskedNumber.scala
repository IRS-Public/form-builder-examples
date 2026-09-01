package gov.irs.directfile.inputs

import gov.irs.formbuilder.parser.{ Input, InputContext, InputParser }

/** The five Direct File inputs that are one text box holding a fixed run of digits.
  *
  * `<input type="tin"/>`, `"ein"`, `"pin"`, `"ip-pin"` and `"phone-number"` differ only in the Fact Graph node they
  * bind to, how the browser groups the digits, and what to say when they are wrong. None of that is parsing, so this is
  * one parameterised parser with five instances rather than five near-identical objects — the alternative was 60 lines
  * saying "same as the one above, but EIN".
  *
  * What the type name buys, given the shape is shared:
  *
  *   - `nodeType` is checked against the fact dictionary by `fg-set`, so `<input type="pin"/>` on a `TIN` fact fails
  *     the build rather than at the first keystroke.
  *   - the name selects `templates/nodes/inputs/{name}.html`, which is where the grouping and the `maxlength` live.
  *   - the name selects the browser handlers registered under it in `website-static/js/inputs/masked-number.js`, which
  *     is where the Fact Graph factory for that type is called.
  *
  * These render a plain `<input>` and let `fg-set` put the question label in front of it, so `suppliesOwnLabel` stays
  * false — unlike [[Address]] and [[BankAccount]], which are fieldsets over several boxes.
  */
final class MaskedNumber(val name: String, val nodeType: String) extends InputParser {
  override def parse(context: InputContext): Input =
    Input.custom(name = name, optional = context.optional, nodeType = Some(nodeType))
}

object MaskedNumber {

  /** A Social Security number or ITIN — 9 digits, written 123-45-6789. */
  val tin = MaskedNumber("tin", "TinNode")

  /** An employer identification number — 9 digits, written 12-3456789. */
  val ein = MaskedNumber("ein", "EinNode")

  /** The 5-digit self-select PIN used to sign a return. */
  val pin = MaskedNumber("pin", "PinNode")

  /** The 6-digit Identity Protection PIN the IRS issues. */
  val ipPin = MaskedNumber("ip-pin", "IpPinNode")

  /** A US phone number — 10 digits, stored in E.164 as +1XXXXXXXXXX. */
  val phoneNumber = MaskedNumber("phone-number", "PhoneNumberNode")

  /** Every one of them, ready for `FormBuilderApp.inputTypes`. */
  val all: Map[String, InputParser] =
    List(tin, ein, pin, ipPin, phoneNumber).map(parser => parser.name -> parser).toMap
}
