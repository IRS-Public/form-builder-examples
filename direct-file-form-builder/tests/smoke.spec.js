// Does the generated site actually run? Six questions, over the first few pages of the flow.
//
// WHY THIS EXISTS. The port's two parity gates are `make transpile-verify`, and between them they
// compare 89,329 in-engine decisions against Direct File's own — which is a far better check of gate
// semantics than any browser test, and never renders a page. So they cannot see a fact path the
// browser cannot write, an input type that fails to register, or a module that throws at import.
// Both of those have happened here: 47 questions threw `requirement failed` until seed-fact-graph.js
// created the second filer, and three input modules threw out of connectedCallback on every page
// holding an unanswered address or TIN. Neither moved a single number in the parity run.
//
// WHY IT IS SMALL. This is a smoke test, not a second flow suite. It covers the first few pages, in
// order, with one scenario — enough that a site which does not run fails here, and little enough
// that it stays true as the flow moves. `verify-visibility.ts` remains the place that knows which
// screen shows for whom; nothing here re-asks that question.
//
//     make site && make smoke
//
// English only. `flow_es.yaml` is still keyed by a build that has not happened, so the Spanish pages
// render English text under Spanish chrome — a known state, documented in docs/PORTING.md, and not
// something a smoke test should pin.
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

/** `FormBuilderApp.basePath`. Every route below carries it, since baseURL is the origin alone. */
const APP = '/app/direct-file'
const INTRO = `${APP}/you-and-your-family/about-you/about-you-intro/`
const BASIC = `${APP}/you-and-your-family/about-you/your-basic-information/lets-get-some-basic/`

/** One of the 161 corpus returns, seeded the way the Scenario picker seeds one. */
const SCENARIO = readFileSync(
  new URL('../src/main/resources/direct-file/scenarios/HOH_32k_EITC.json', import.meta.url),
  'utf8'
)

/**
 * Fail the test on anything the browser logged as an error.
 *
 * Deliberately fatal rather than reported. Every failure this file was written to catch showed up
 * first as an uncaught exception that left the page looking fine — a control that never bound, a
 * value that never committed. A page that logs an error has not loaded, whatever it looks like.
 */
function failOnPageErrors (page) {
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error).split('\n')[0]))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

/** What the Fact Graph in the browser holds for `path`, or null when it has no value. */
function factValue (page, path) {
  return page.evaluate((p) => {
    const result = window.factGraph.get(p)
    return result.hasValue ? String(result.get) : null
  }, path)
}

/** Seed a scenario before any of the page's own scripts run, as fg-fact-graph.js expects to find it. */
async function seedScenario (page) {
  await page.addInitScript((graph) => {
    sessionStorage.setItem('direct-file:factGraph', graph)
  }, SCENARIO)
}

/** Every route the generated site has, in flow order — what fg-navigator.js reads to skip pages. */
const manifestRoutes = JSON.parse(
  readFileSync(new URL('../out/app/direct-file/resources/flow-manifest.json', import.meta.url), 'utf8')
).map((entry) => entry.route)

const nextButton = (page) => page.locator('.form-actions a.usa-button:not(.usa-button--outline)')

/** The screen's own heading. `<h1>` is the site brand on every page; the flow's headings are `<h2>`. */
const screenHeading = (page) => page.locator('#main-content h2').first()

/** Commit the field that has focus, the way moving on does. */
const blur = (page) => page.locator('body').click({ position: { x: 5, y: 5 } })

test.describe('the generated site runs', () => {
  test('the first page loads, boots the Fact Graph, and logs nothing', async ({ page }) => {
    const errors = failOnPageErrors(page)
    await page.goto(INTRO)

    await expect(screenHeading(page)).toContainText('In this section')
    // The runtime's own bootstrap: fg-fact-graph.js publishes the graph it built from the dictionary.
    expect(await page.evaluate(() => typeof window.factGraph?.get)).toBe('function')
    expect(errors).toEqual([])
  })

  test('both filers are seeded, so /primaryFiler resolves', async ({ page }) => {
    await page.goto(INTRO)

    // `/primaryFiler` is a <Find> over `/filers` and `/secondaryFiler` reads through the derived
    // `isSecondaryFiler`; against an empty collection neither resolves and 47 questions throw on the
    // first keystroke. seed-fact-graph.js creates both items, which is why this asserts two and not
    // one. See the note in that file for why two does not assert a spouse.
    expect(await page.evaluate(() => window.factGraph.getCollectionIds('/filers').length)).toBe(2)
    expect(await factValue(page, '/primaryFiler/isPrimaryFiler')).toBe('true')
  })

  test('an answer typed into a question reads back out of the Fact Graph', async ({ page }) => {
    const errors = failOnPageErrors(page)
    await page.goto(BASIC)

    await page.fill(`fg-set[path="/primaryFiler/firstName"] input`, 'Minnie')
    await page.fill(`fg-set[path="/primaryFiler/lastName"] input`, 'Mouse')
    // The date input commits on `change` once all three parts are filled, so the year goes last.
    await page.selectOption(`fg-set[path="/primaryFiler/dateOfBirth"] select`, '04')
    await page.fill(`fg-set[path="/primaryFiler/dateOfBirth"] input[name*="-day"]`, '03')
    await page.fill(`fg-set[path="/primaryFiler/dateOfBirth"] input[name*="-year"]`, '1989')
    await blur(page)

    expect(await factValue(page, '/primaryFiler/firstName')).toBe('Minnie')
    expect(await factValue(page, '/primaryFiler/lastName')).toBe('Mouse')
    expect(await factValue(page, '/primaryFiler/dateOfBirth')).toBe('1989-04-03')
    expect(errors).toEqual([])
  })

  test('a required question blocks Continue, and answering it unblocks', async ({ page }) => {
    await page.goto(BASIC)

    await nextButton(page).click()
    await expect(page).toHaveURL(new RegExp(`${BASIC}$`))
    await expect(page.locator('.usa-alert--error')).toBeVisible()

    await page.fill(`fg-set[path="/primaryFiler/firstName"] input`, 'Minnie')
    await page.fill(`fg-set[path="/primaryFiler/lastName"] input`, 'Mouse')
    await page.selectOption(`fg-set[path="/primaryFiler/dateOfBirth"] select`, '04')
    await page.fill(`fg-set[path="/primaryFiler/dateOfBirth"] input[name*="-day"]`, '03')
    await page.fill(`fg-set[path="/primaryFiler/dateOfBirth"] input[name*="-year"]`, '1989')
    await blur(page)

    await nextButton(page).click()
    await expect(page).toHaveURL(/your-contact-information/)
  })

  test('a page of unanswered custom inputs renders without throwing', async ({ page }) => {
    // The narrowest regression test in the file, and it pins a bug the seeded walk below cannot see.
    // `Result.get` throws on an incomplete result rather than answering undefined, so an input module
    // that reads `fact?.get` in its `write` throws out of connectedCallback — but only for a fact
    // nobody has answered yet. A walk through a seeded return has every fact complete and sails past
    // it. So: a fresh graph, and the first page whose questions are all custom types.
    //
    // Address and phone number here; the same `write` shape is in bank-account.js,
    // collection-item-reference.js and all five masked numbers.
    const errors = failOnPageErrors(page)
    await page.goto(`${APP}/you-and-your-family/about-you/your-contact-information/`)

    await expect(page.locator(`fg-set[path="/address"] input`).first()).toBeVisible()
    await expect(page.locator(`fg-set[path="/phone"] input`)).toBeEmpty()
    expect(errors).toEqual([])
  })

  test('the first stretch of the flow walks through, page after page', async ({ page }) => {
    // The check neither a unit test nor the parity gates can make, and the one that would have caught
    // both of the render-level bugs this port has had: a fact path the browser could not write, and an
    // input module that threw out of connectedCallback. Ten pages is enough to cross four screens'
    // worth of input types — text, date, address, phone number, boolean — and short enough to stay
    // true as the flow moves.
    //
    // Seeded with a real return, so the walk follows a taxpayer the flow was built for. Answering
    // arbitrarily knocks you out around the fourth question, which is correct behaviour and a useless
    // test.
    const errors = failOnPageErrors(page)
    await seedScenario(page)
    await page.goto(INTRO)

    const visited = []
    for (let step = 0; step < 10; step += 1) {
      // A page whose gate is false replaces the location as it loads; let that settle before reading.
      await page.waitForLoadState('networkidle')
      await expect(screenHeading(page)).toBeVisible()
      visited.push(new URL(page.url()).pathname)

      const before = page.url()
      await nextButton(page).click()
      await expect(page).not.toHaveURL(before)
    }

    // Every page distinct, so a Next that bounced between two pages fails rather than looking busy.
    expect(new Set(visited).size).toBe(visited.length)
    expect(errors).toEqual([])
  })

  test('the step indicator counts the 25 sections, not the pages', async ({ page }) => {
    // 138 pages ran off the side of the viewport and "1 of 138" was not a number anyone tracked. One
    // segment per flow module, labelled from the same all-screens.section.* keys Browse All uses.
    await seedScenario(page)
    await page.goto(INTRO)

    await expect(page.locator('.usa-step-indicator__segment')).toHaveCount(25)
    await expect(page.locator('.usa-step-indicator__total-steps')).toContainText('25')
    await expect(page.locator('.usa-step-indicator__heading-text')).toHaveText('About you')
    await expect(page.locator('.usa-step-indicator__current-step')).toHaveText('1')

    // …and it follows the flow rather than sitting on the first section. The route is read out of the
    // manifest rather than written here: a page's own route moves whenever the splitter's slugs do,
    // and this is an assertion about the *section*, which does not.
    const route = manifestRoutes.find((r) => r.startsWith('/income/hsa/'))
    expect(route, 'the flow should still have an HSA module').toBeDefined()
    await page.goto(`${APP}${route}/`)
    await expect(page.locator('.usa-step-indicator__heading-text')).toHaveText('Health Savings Accounts')
    await expect(page.locator('.usa-step-indicator__current-step')).toHaveText('11')
  })
})
