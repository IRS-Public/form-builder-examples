package gov.irs.directfile.inputs

import gov.irs.factgraph.compnodes.CollectionItemNode
import gov.irs.factgraph.FactDefinition
import gov.irs.formbuilder.exceptions.InvalidFormConfig
import gov.irs.formbuilder.parser.{ Input, InputContext, InputParser }

/** `<input type="collection-item-reference"/>` — which item of another collection this fact points at.
  *
  * Thirteen of Direct File's questions are this one shape: whose W-2 is this, whose 1099-G, which of the people in the
  * household qualifies you for head of household. The fact behind each is a `<Writable><CollectionItem
  * collection="…"/></Writable>`, and the answer is one collection item's id.
  *
  * ## Two things vary, and they come from different places
  *
  * **Which collection** is read out of the fact dictionary here rather than written in the Flow XML. The dictionary
  * already says it — `<CollectionItem collection="/filers"/>` becomes a `CollectionItemNode` whose alias is that path —
  * and a second copy in the flow would be a second thing to keep right. Resolving it at parse time also means a fact
  * that is not a collection reference fails the build with the path in the message, rather than rendering a question
  * with no options in it.
  *
  * **What to call each item** cannot come from the dictionary, because it is prose: upstream labels the options from
  * `fields.{path}.item`, a string of fact references evaluated once per item — `{{/filers/ * /firstName}} {{/filers/ *
  * /lastName}}`. That is authored content, so it travels in the flow as `item-label` on the `<input>` and the browser
  * substitutes each item's id into it (see `website-static/js/inputs/collection-item-reference.js`).
  *
  * Note that the label's collection need not be the referenced one. `/hohQualifyingPerson` references
  * `/hohQualifyingPeople`, which is a `<Filter>` over `/familyAndHousehold`, and its label names
  * `{{/familyAndHousehold/ * /firstName}}`. The ids are the same ids either way — a filter selects from its source
  * rather than re-keying it — so the substitution resolves. This is why the label is carried whole rather than as a
  * list of leaf names to hang off the collection path.
  *
  * Like [[Address]] and [[BankAccount]] this is a fieldset over several controls, so it renders its own label and
  * `suppliesOwnLabel` is true.
  */
object CollectionItemReference extends InputParser {

  val name = "collection-item-reference"

  override def parse(context: InputContext): Input = {
    val itemLabel = context.inputNode \@ "item-label"
    if (itemLabel.isEmpty) {
      throw InvalidFormConfig(s"<input type=\"$name\"/> needs an item-label attribute, at question ${context.path}")
    }

    Input.custom(
      name = name,
      optional = context.optional,
      templateVariables = Map("collection" -> collectionOf(context), "itemLabel" -> itemLabel),
      nodeType = Some("CollectionItemNode"),
      suppliesOwnLabel = true,
    )
  }

  /** The collection this question's fact refers into, from its `<Writable><CollectionItem collection="…"/>`.
    *
    * `fg-set` checks `nodeType` separately and would already have rejected a fact of the wrong type, but it does so
    * against the string form of the node. This reads the alias off the node itself, so the two cannot disagree — and an
    * alias-less `CollectionItemNode`, which the engine allows for a derived one, is caught here rather than reaching
    * the browser as a picker over nothing.
    */
  private def collectionOf(context: InputContext): String =
    context.factDictionary(context.path) match {
      case definition: FactDefinition =>
        definition.value match {
          case node: CollectionItemNode =>
            node.alias
              .map(_.toString)
              .getOrElse(
                throw InvalidFormConfig(
                  s"${context.path} is a collection item that names no collection, so " +
                    s"<input type=\"$name\"/> has nothing to list",
                ),
              )
          case other =>
            throw InvalidFormConfig(
              s"<input type=\"$name\"/> needs a <CollectionItem> fact; ${context.path} is a ${other.getClass.getSimpleName}",
            )
        }
      // `FactDictionary.apply` returns `FactDefinition | Null`, so this is the not-declared case and
      // nothing else — spelled `null` rather than `_` because the compiler can see that too.
      case null =>
        throw InvalidFormConfig(
          s"<input type=\"$name\"/> names ${context.path}, which the fact dictionary does not declare",
        )
    }
}
