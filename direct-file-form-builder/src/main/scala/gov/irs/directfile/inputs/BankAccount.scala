package gov.irs.directfile.inputs

import gov.irs.formbuilder.parser.{ Input, InputContext, InputParser }

/** `<input type="bank-account"/>` — the routing number, the account number and which kind of account it is.
  *
  * `BankAccountFactory(accountType, routingNumber, accountNumber)` is the shape, and this collects the three. Like
  * [[Address]] it is a fieldset over several boxes, so it renders its own labels.
  *
  * The account type is a pair of radios rather than a `<select>` because there are two of them, and it is not an
  * `EnumNode` — `Checking`/`Savings` are fields of the `BankAccount` value, not options on a fact, which is why this
  * cannot be assembled out of a built-in `enum` and two `text`s.
  */
object BankAccount extends InputParser {
  override def parse(context: InputContext): Input =
    Input.custom(
      name = "bank-account",
      optional = context.optional,
      nodeType = Some("BankAccountNode"),
      suppliesOwnLabel = true,
    )
}
