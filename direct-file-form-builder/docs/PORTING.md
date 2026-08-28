# Porting Direct File onto Form Builder

This application is a port of the questionnaire in
[IRS Direct File](https://github.com/IRS-Public/direct-file)'s `df-client-app` onto
`gov.irs::form-builder`, with the `taxpert` workspace over it. Auth, MeF submission, PDF
generation, data import, the state-API handoff and telemetry are out of scope: what is being ported
is the flow and the fact dictionary underneath it.

The Flow XML here is **generated output**. Corrections belong in the transpiler, never in the
emitted XML, so that the port stays reproducible against an upstream that is still moving.

## The fact dictionary is a copy, not a translation

`facts/` holds Direct File's 36 modules — 3,030 `<Fact>` elements, ~65,000 lines — carried over
unchanged, together with the `FactDictionaryModule.rng` they were authored under. That works
because `gov.irs:factgraph:3.1.0-SNAPSHOT` is the standalone successor to the v3.0 engine Direct
File runs in production, and because everything the two grammars disagree about is metadata the
engine never reads: `FactConfigElement` takes only `Writable`, `Derived`, `Placeholder`,
`OverrideCondition` and `OverrideDefault` off a `<Fact>`, so `<Name>`, `<Description>`, `<Export>`,
`<ExportZero>`, `<TaxYear>` and `<BlockSubmissionOnTrue>` come along as inert text.

33 of the 36 modules are byte-identical to upstream. Three files differ, and each difference is
recorded below.

### What proved it

A probe flow bound to real fact paths — `/maritalStatus`, `/receivedDigitalAssets`,
`/studentLoanInterestAmount`, with `/isMarried` and `/taxYear` derived — built green, and the
generated `out/app/direct-file/resources/fact-dictionary.xml` carries all 3,030 facts to the
browser. The check has teeth: pointing one `fg-set` at a path that does not exist fails the build
with `InvalidFormConfig: /thisFactDoesNotExist not found in the fact dictionary`.

The probe is gone — the transpiler's output replaced it, as its header said it would — and the
safety net it demonstrated now covers the real thing: 713 screens across 217 pages, and 518
synthesized gate facts whose every dependency is checked against this dictionary before the XML is
written.

## Deviations from upstream

### `FactDictionaryModule.rng` — widened, twice

The grammar is app-owned here, as it is in every application in this repository, so it is widened
rather than worked around. Both gaps are upstream's grammar failing to describe upstream's own
dictionary; nothing there caught them, because nothing there runs this schema.

| Where | Widened to allow | Used by |
|---|---|---|
| `FilterContent` | an optional `module` attribute, matching `DependencyContent` | `<Filter module="familyAndHousehold" path="/cdccQualifyingPeople">`, 4× in `cdcc.xml` |
| `SubtrahendsContent` | `LogicalContent`, matching `MinuendContent` | `<Subtrahends><Switch>`, 5× in `eitc.xml` |

### `elderlyAndDisabled.xml` — one authoring defect, preserved

`/edcShouldShowCreditOutcomes` writes a `<When>`/`<Then>` pair directly inside its `<Switch>`,
outside any `<Case>`. `Switch.fromDerivedConfig` filters its children to `typeName == "Case"`, so
**the engine has always ignored it**: the fact is a one-case switch that goes `Incomplete` when
`/tpCanBeAskedAboutNonTaxablePayments` is false, rather than the `otherwise true` the author meant.

The pair is commented out here rather than wrapped in a `<Case>`. Wrapping it would fix the bug and
change what the fact evaluates to, and a port whose gate is parity against upstream's 175 snapshot
scenarios is the wrong place to change tax logic. This is worth reporting upstream.

### `standardDeduction.xml` — one stray text node, commented

`/minimumStandardDeduction` carries the citation `Rev Proc .15 Standard Deduction §63(c)(5)` as
bare text inside `<Fact>`, where the grammar expects elements. Wrapped in an XML comment. The
engine ignored it before and ignores it now.

## The flow is generated

The Flow XML under `src/main/resources/direct-file/flow/` is transpiler output and is never
hand-edited, and so is `facts/flowGates.xml` — 518 synthesized Boolean facts, one per distinct set
of screen conditions. See [../codemod/README.md](../codemod/README.md) for the contract, the stage
list, and the condition-operator table the gate facts are built from.

25 modules, 217 pages, 713 screens. `flow/index.xml` lists the modules in flow order; each module is
one Direct File subcategory and each page is a contiguous run of its declaration order.

`locales/flow_es.yaml` is empty on purpose until stage 4. Its key set is owned by the generated
`flow_en.yaml`, so every key in it today would be a translation of a placeholder. Direct File ships
its own `es` locale beside the `en` one its content components name, and stage 4 emits both files
from it; until then the resolver falls back to English and the `/es/` pages render the English
placeholders.

## Library changes this port needed

Two, both landed in `form-builder` rather than worked around here, because each is something any
application with a custom input or a copy-one-fact-to-another action would want.

1. **`registerInputType()`** in the flow runtime's `input-types.js`. `parser/Input.scala` already
   let an application register a custom `<input type>`; the browser half was hardcoded in five
   `switch (this.inputType)` blocks in `fg-set.js`. Without it each of this port's eight custom
   inputs would have been a wrapper custom element duplicating `fg-set`'s error handling.
2. **`<fg-apply source="/path">`**, the alternative to `value`, for the 73 `SetFactAction`s in
   Direct File's flow. Exactly one of the two is required.

`<br/>` needed no library change, contrary to the plan: `parser/Html.scala` treats `<p>`, `<li>`,
`<td>` and the headings as leaf nodes and re-emits their inner markup verbatim, so a `<br/>` inside
one already survives. Only this application's `flow/FlowConfig.rng` rejected it, and that grammar
is widened here — as is `fg-apply` itself, which form-builder parses but never described in its
seed grammar, no application here having used one before.

## Hazards

- **`make format` reformats `facts/*.xml`** with `xmllint --format`. Running it would rewrite all
  36 modules and destroy the byte-for-byte correspondence with upstream that makes the copy
  auditable. Format the Scala and the JavaScript by hand instead until the flow is generated.
- **`facts/*.xml` merge in sorted filename order, last `<Fact path>` wins.** Direct File ships a
  `flow.xml` in its `tax/` directory; it is a *fact* module about flow state, and it belongs in
  `facts/`, not in `flow/`.

## One build.sbt line the other applications do not have

`Compile / unmanagedResources / excludeFilter` prunes `node_modules` as well as `flow_en.yaml`.

`src/main/resources/direct-file/node_modules` is lint tooling — eslint, html-validate, and the USWDS
distribution `make copy-uswds` lifts out of it. None of it belongs on the classpath, and all ~16,000
files of it were being copied into `target/classes` and then jarred. Past roughly that size the copy
and the packaging step disagree about what is there, and the build dies with a
`FileNotFoundException` naming some file deep inside a dependency — intermittently, so a retry often
appears to fix it. Roughly one `make ci` in two failed here before the exclusion, which makes a
transpiler you re-run constantly unworkable.

**This is not a problem the port introduced.** Every application in this repository keeps a
`node_modules` under `src/main/resources`; benefits-enrollment, whose tree is the same size, flakes
the same way and did so before this application existed. credit-assistant's is a third smaller and
does not. The fix belongs in the cookiecutter and in the other three, and has deliberately not been
made there from here — that is a change to somebody else's application and wants its own commit.

Both clauses of the filter are load-bearing. sbt applies `excludeFilter` to each file rather than
using it to prune the directory, so matching the directory's own name alone excludes one entry and
keeps all 15,831 underneath it.
