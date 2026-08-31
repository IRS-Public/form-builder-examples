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

25 modules, 138 pages, 713 screens, 19 collections. `flow/index.xml` lists the modules in flow
order; each module is one Direct File subcategory and each page is a contiguous run of its
declaration order — except that a collection loop's runs are absorbed into a single
`<fg-collection>`, which is what turns 218 runs into 138 pages.

`locales/flow_es.yaml` is empty on purpose until stage 4. Its key set is owned by the generated
`flow_en.yaml`, so every key in it today would be a translation of a placeholder. Direct File ships
its own `es` locale beside the `en` one its content components name, and stage 4 emits both files
from it; until then the resolver falls back to English and the `/es/` pages render the English
placeholders.

## Library changes this port needed

Three, all landed in `form-builder` rather than worked around here, because each is something
another application would want.

1. **`registerInputType()`** in the flow runtime's `input-types.js`. `parser/Input.scala` already
   let an application register a custom `<input type>`; the browser half was hardcoded in five
   `switch (this.inputType)` blocks in `fg-set.js`. Without it each of this port's eight custom
   inputs would have been a wrapper custom element duplicating `fg-set`'s error handling.
2. **`<fg-apply source="/path">`**, the alternative to `value`, for the 73 `SetFactAction`s in
   Direct File's flow. Exactly one of the two is required.
3. **`<fg-collection readonly="true">`**, which renders no Add button and no per-item Remove. Eight
   of this port's nineteen collections iterate a `<Derived><Filter>` collection, whose membership
   another fact decides; on one of those an Add button is not redundant but a crash, since `addItem`
   writes the collection fact. It does not make the fields read-only, which is a different gap
   benefits-enrollment's `review.xml` still names.

`<br/>` needed no library change, contrary to the plan: `parser/Html.scala` treats `<p>`, `<li>`,
`<td>` and the headings as leaf nodes and re-emits their inner markup verbatim, so a `<br/>` inside
one already survives. Only this application's `flow/FlowConfig.rng` rejected it, and that grammar
is widened here — as is `fg-apply` itself, which form-builder parses but never described in its
seed grammar, no application here having used one before.

## The workspace over it

Standard mount — the cookiecutter's four fragments, filled in. Three things in it are Direct File's
rather than the template's:

- **The Outcome tracker's five outcomes**, in `website-static/js/taxpert/direct-file-graph.js`: the
  return, then each of the four credits that can move it (EITC, CTC/ODC, CDCC, PTC), because "why is
  this number what it is" is the question the tracker exists to answer and the answer is nearly
  always a credit. The headline is `/dueRefund` as a boolean rather than a signed amount: Direct File
  has no fact that runs positive for a refund and negative for a balance due — `/overpayment` and
  `/balanceDue` are both clamped at zero by a `<GreaterOf>`, so one of them is always $0 — and
  `/dueRefund` / `/owesBalance` are the booleans the payment-method screens already branch on.
- **The Browse All section headings**, one per flow module, in `locales/en.yaml` and `es.yaml`. Each
  is Direct File's own `checklist.{subcategoryRoute}.heading`, in both languages, because a flow
  module here *is* one of its subcategories. This is the one place Spanish is real before stage 4.
- **The Applications switcher**, listing all four applications in this repository. The three siblings
  are added to this app's `taxpert-config.html` and this app to each of theirs, so the workspace
  carries over from any one of them to any other.

`brand.css` is deliberately still the cookiecutter's empty placeholder. The theme is USWDS and so is
Direct File; there is no token this application needs to re-tint, and benefits-enrollment left the
same file untouched for the same reason. Inventing a palette to have written something would be
worse than the blank file.

## Hazards

- **`make format` reformats `facts/*.xml`** with `xmllint --format`. Running it would rewrite all
  36 modules and destroy the byte-for-byte correspondence with upstream that makes the copy
  auditable. Format the Scala and the JavaScript by hand instead until the flow is generated.
- **`facts/*.xml` merge in sorted filename order, last `<Fact path>` wins.** Direct File ships a
  `flow.xml` in its `tax/` directory; it is a *fact* module about flow state, and it belongs in
  `facts/`, not in `flow/`.

## One build.sbt setting the other applications do not have

`Compile / unmanagedResources / excludeFilter` prunes two generated trees as well as `flow_en.yaml`:
`src/main/resources/direct-file/node_modules` (14,638 files of lint tooling — eslint, html-validate,
and the USWDS distribution `make copy-uswds` lifts out of it) and
`website-static/vendor/` (2,683 files: the taxpert, USWDS and Fact Graph mirrors, all gitignored,
each with exactly one writer).

Neither is ever read from the classpath. The site generator reads `website-static/` from disk —
`Website.scala` does `os.copy(app.websiteStaticDir, …)` — and the Dockerfile serves `out/` from
nginx rather than running the jar. So 17,000 files were being copied into `target/classes` and
packaged for nothing.

### The intermittent build failure, correctly diagnosed the second time

An earlier version of this section claimed the exclusion *fixed* a `FileNotFoundException` in
`Compile / packageBin`, and attributed that failure to a file-count threshold — "past roughly 16,000
files the copy and the packaging step disagree". **That was wrong**, and the exclusion does not fix
it. The failure still happens, now sometimes as `ClassNotFoundException: gov.irs.directfile.main`.

The cause is two sbt builds sharing one output directory. `docker-compose.override.yml` runs a watch
container that bind-mounts this repository at `/build/direct-file-form-builder` and runs `sbt ~run`
inside it, so `target/scala-3.7.2/classes` has two writers. `make copy-uswds` opens with an `rm -rf`
of its target, which retriggers that watcher on *every* host build — the container's own log records
`Build triggered by …/uswds-3.13.0/img/material-icons/wash.svg`, and then the same exception on the
same shared path. Whichever build is mid-`packageBin` when the other is mid-`copyResources` dies.

- **Workaround:** `make down` (or stop that one container) before running host builds.
- **Fix:** give the container its own `target/`, in the compose files. That is the same change in all
  four applications and has deliberately not been made from here.

**Neither the flake nor the resource trees are something the port introduced.** Every application in
this repository keeps a `node_modules` and a `website-static/vendor/` under `src/main/resources`, and
every one of them has a watch container that bind-mounts its own repository the same way.
