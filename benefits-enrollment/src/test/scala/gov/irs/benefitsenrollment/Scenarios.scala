package gov.irs.benefitsenrollment

import gov.irs.factgraph.types.{ Day, Dollar, Enum as FgEnum, MultiEnum }
import gov.irs.factgraph.Graph

/** The scenario corpus, as code.
  *
  * A scenario file is the Fact Graph persister's own JSON — `{path: {$type, item}}` — so writing one by hand means
  * hand-encoding `DayWrapper`, `MultEnumWrapper` (sic) and `Dollar`'s two-decimal string, against no schema and with no
  * check that the paths exist. These build a real graph instead and serialize it, so a typo in a fact path fails here
  * rather than in a browser. `GenerateScenarios` writes them; `ScenariosSpec` proves the committed files still match.
  *
  * The personas are the prototype's, not invented: each one is a route through ~/usds-benefits-enrollment-prototype
  * that the conversion had to keep working, and the comment on each says which.
  */
object Scenarios:

  /** One scenario: the filename stem, the sentence Taxpert shows, and how to fill a graph. */
  case class Scenario(name: String, summary: String, fill: Graph => Unit):
    /** The label Form Builder derives for the scenario picker — `Website.scala` splits the stem on `_` and capitalizes.
      * Kept here so a name that reads badly in the menu is visible at authoring time.
      */
    def label: String = name.split("_").map(_.capitalize).mkString(" ")
    def filename: String = s"$name.json"

  // Collection ids are fixed rather than random so regenerating produces an identical file and a
  // real diff. They must satisfy FactDictionary's UUID_REGEX — an RFC-4122 v1-5 UUID, version
  // nibble 1-5 and variant nibble 8/9/a/b — or the browser cannot resolve the wildcard path at all.
  private def personId(scenario: Int, person: Int): String =
    f"be$scenario%06d-0000-4000-a000-${person}%012d"

  // ── the questions everyone is asked ──────────────────────────────────────────────────────

  private def screener(graph: Graph, benefits: Set[String], zip: String, income: Option[Int]): Unit =
    graph.set("/benefitChoices", MultiEnum(benefits, "/benefitOptions"))
    graph.set("/householdZipCode", zip)
    income.foreach(amount => graph.set("/screenerHouseholdIncome", Dollar(amount)))

  private def mailingAddress(graph: Graph, street: String, city: String, state: String, zip: String): Unit =
    graph.set("/mailingAddressStreet", street)
    graph.set("/mailingAddressCity", city)
    graph.set("/mailingAddressState", FgEnum(state, "/stateOptions"))
    graph.set("/mailingAddressZip", zip)
    graph.set("/isMailAndHomeTheSame", true)

  private def contact(graph: Graph, phone: String, email: String): Unit =
    graph.set("/contactPhone", phone)
    graph.set("/contactEmail", email)
    graph.set("/notificationPreferences", MultiEnum(Set("text", "email"), "/notificationPreferenceOptions"))
    graph.set("/smsPhone", phone)
    graph.set("/notificationTimes", MultiEnum(Set("morning"), "/notificationTimeOptions"))

  private def expenses(graph: Graph, savings: Int, rent: Int, food: Int, medical: Int): Unit =
    graph.set("/householdSavings", Dollar(savings))
    graph.set("/householdRentMortgage", Dollar(rent))
    graph.set("/mealShareFoodExpenses", Dollar(food))
    graph.set("/medicalExpenses", Dollar(medical))
    graph.set("/hasHeatingCoolingExpenses", true)
    graph.set("/hasOtherUtilities", true)

  private def signature(graph: Graph, name: String): Unit =
    graph.set("/agreeToTerms", true)
    graph.set("/applicantSignature", name)

  /** Adds one person and answers the battery every member gets. Returns the item path prefix. */
  private def person(
      graph: Graph,
      id: String,
      first: String,
      last: String,
      born: String,
      sex: String,
      ssn: String,
      relationship: Option[String],
      isSelf: Boolean = false,
      isApplicant: Boolean = true,
      inTaxHousehold: Boolean = true,
      sharesMeals: Boolean = true,
      incomeTypes: Set[String] = Set.empty,
  ): String =
    graph.addToCollection("/householdMembers", id)
    val p = s"/householdMembers/#$id"
    graph.set(s"$p/isSelf", isSelf)
    graph.set(s"$p/isApplicant", isApplicant)
    graph.set(s"$p/inTaxHousehold", inTaxHousehold)
    graph.set(s"$p/sharesMeals", sharesMeals)
    graph.set(s"$p/firstName", first)
    graph.set(s"$p/lastName", last)
    graph.set(s"$p/dateOfBirth", Day(born))
    graph.set(s"$p/sex", FgEnum(sex, "/sexOptions"))
    graph.set(s"$p/ssn", ssn)
    // The filer is never asked how they are related to themselves — /flowIsNotSelf gates it.
    relationship.foreach(r => graph.set(s"$p/relationship", FgEnum(r, "/relationshipOptions")))
    graph.set(s"$p/commonCases", MultiEnum(Set.empty[String], "/commonCaseOptions"))
    graph.set(s"$p/livesAtMailingAddress", true)
    graph.set(s"$p/incomeTypes", MultiEnum(incomeTypes, "/incomeTypeOptions"))
    graph.set(s"$p/isCitizen", true)
    p

  /** One job in slot 1, and the two "do you have another?" answers that keep slots 2 and 3 shut. */
  private def oneJob(graph: Graph, p: String, employer: String, wages: Int, hours: Int): Unit =
    graph.set(s"$p/job1EmployerName", employer)
    graph.set(s"$p/job1PayFrequency", FgEnum("everyTwoWeeks", "/payFrequencyOptions"))
    graph.set(s"$p/job1Wages", Dollar(wages))
    graph.set(s"$p/job1HoursPerPayPeriod", hours)
    graph.set(s"$p/hasSecondJob", false)

  // ── the corpus ───────────────────────────────────────────────────────────────────────────

  val all: List[Scenario] = List(
    Scenario(
      "single_adult_over_the_income_limit",
      "One adult applying for food assistance with $12,000 in the last 30 days — the prototype's not-eligible.html.",
      graph => {
        screener(graph, Set("foodAssistance"), "20814", Some(12000))
        graph.set("/applyingFor", FgEnum("myself", "/applyingForOptions"))
        mailingAddress(graph, "8600 Rockville Pike", "Bethesda", "MD", "20814")
        contact(graph, "(301) 555-0142", "dana.reyes@example.com")
        val p = person(
          graph,
          personId(1, 1),
          "Dana",
          "Reyes",
          "1986-03-14",
          "female",
          "412-55-0198",
          relationship = None,
          isSelf = true,
          incomeTypes = Set("job"),
        )
        oneJob(graph, p, "Riverside Diner", 6000, 70)
        expenses(graph, 400, 1650, 500, 120)
        signature(graph, "Dana Reyes")
      },
    ),
    Scenario(
      "single_adult_under_the_income_limit",
      "The same applicant at $1,800 — the screener's other arm, eligible.html.",
      graph => {
        screener(graph, Set("foodAssistance"), "20814", Some(1800))
        graph.set("/applyingFor", FgEnum("myself", "/applyingForOptions"))
        mailingAddress(graph, "8600 Rockville Pike", "Bethesda", "MD", "20814")
        contact(graph, "(301) 555-0142", "dana.reyes@example.com")
        val p = person(
          graph,
          personId(2, 1),
          "Dana",
          "Reyes",
          "1986-03-14",
          "female",
          "412-55-0198",
          relationship = None,
          isSelf = true,
          incomeTypes = Set("job"),
        )
        oneJob(graph, p, "Riverside Diner", 900, 24)
        expenses(graph, 400, 1650, 500, 120)
        signature(graph, "Dana Reyes")
      },
    ),
    Scenario(
      "family_of_four_both_programs",
      "Two parents and two children applying for food assistance and health coverage together.",
      graph => {
        screener(graph, Set("foodAssistance", "healthcare"), "44113", Some(3400))
        graph.set("/applyingFor", FgEnum("meAndSomeoneElse", "/applyingForOptions"))
        mailingAddress(graph, "1240 Detroit Avenue", "Cleveland", "OH", "44113")
        contact(graph, "(216) 555-0173", "m.okafor@example.com")
        val filer = person(
          graph,
          personId(3, 1),
          "Maria",
          "Okafor",
          "1990-11-02",
          "female",
          "298-44-1073",
          relationship = None,
          isSelf = true,
          incomeTypes = Set("job"),
        )
        oneJob(graph, filer, "Lakeside Health Services", 1900, 64)
        val spouse = person(
          graph,
          personId(3, 2),
          "Samuel",
          "Okafor",
          "1988-07-19",
          "male",
          "298-44-2081",
          relationship = Some("spouse"),
          incomeTypes = Set("job"),
        )
        oneJob(graph, spouse, "Cuyahoga Transit", 1500, 60)
        person(
          graph,
          personId(3, 3),
          "Ada",
          "Okafor",
          "2014-05-30",
          "female",
          "298-44-3099",
          relationship = Some("child"),
        )
        person(
          graph,
          personId(3, 4),
          "Noah",
          "Okafor",
          "2018-09-08",
          "male",
          "298-44-4102",
          relationship = Some("child"),
        )
        expenses(graph, 1200, 1150, 800, 300)
        signature(graph, "Maria Okafor")
      },
    ),
    Scenario(
      "pregnant_applicant_health_coverage_only",
      "Health coverage only, so the screener never asks income at all — and expecting twins in the spring.",
      graph => {
        // No income: the prototype's .snap-only block hid the question, which is exactly why a
        // Medicaid-only applicant always passed the screener. /isOverScreenerIncomeLimit's
        // IsComplete guard reproduces that rather than knocking out on an unasked question.
        screener(graph, Set("healthcare"), "87102", None)
        graph.set("/applyingFor", FgEnum("myself", "/applyingForOptions"))
        mailingAddress(graph, "515 Central Avenue NW", "Albuquerque", "NM", "87102")
        contact(graph, "(505) 555-0119", "priya.raman@example.com")
        val id = personId(4, 1)
        val p = person(
          graph,
          id,
          "Priya",
          "Raman",
          "1995-01-27",
          "female",
          "521-63-7744",
          relationship = None,
          isSelf = true,
          incomeTypes = Set("job"),
        )
        graph.set(s"$p/commonCases", MultiEnum(Set("pregnant"), "/commonCaseOptions"))
        graph.set(s"$p/dueDate", Day("2027-04-12"))
        graph.set(s"$p/babiesExpected", 2)
        oneJob(graph, p, "Sandia Bookshop", 1450, 60)
        expenses(graph, 900, 1000, 450, 260)
        signature(graph, "Priya Raman")
      },
    ),
    Scenario(
      "roommates_who_share_meals",
      "One filer and two roommates who buy food and cook together — the meal-share household is larger than the tax household.",
      graph => {
        // household-meals-only-names.html existed for exactly this population: people who share
        // meals but are not on the same return. Two Filter aliases over one collection replace it.
        screener(graph, Set("foodAssistance"), "97214", Some(2600))
        graph.set("/applyingFor", FgEnum("myself", "/applyingForOptions"))
        mailingAddress(graph, "2130 SE Belmont Street", "Portland", "OR", "97214")
        contact(graph, "(503) 555-0166", "j.whitefeather@example.com")
        val filer = person(
          graph,
          personId(5, 1),
          "Jesse",
          "Whitefeather",
          "1999-06-11",
          "male",
          "634-71-2250",
          relationship = None,
          isSelf = true,
          incomeTypes = Set("job"),
        )
        oneJob(graph, filer, "Belmont Cycle Repair", 1300, 56)
        val roommateOne = person(
          graph,
          personId(5, 2),
          "Ingrid",
          "Halvorsen",
          "1997-02-03",
          "female",
          "634-71-3318",
          relationship = Some("unrelated"),
          isApplicant = false,
          inTaxHousehold = false,
          incomeTypes = Set("job"),
        )
        oneJob(graph, roommateOne, "Rose City Grocery", 1250, 60)
        val roommateTwo = person(
          graph,
          personId(5, 3),
          "Tomas",
          "Delgado",
          "2000-12-22",
          "male",
          "634-71-4407",
          relationship = Some("unrelated"),
          isApplicant = false,
          inTaxHousehold = false,
          incomeTypes = Set("job"),
        )
        oneJob(graph, roommateTwo, "Hawthorne Print Shop", 1100, 48)
        expenses(graph, 250, 1800, 700, 80)
        signature(graph, "Jesse Whitefeather")
      },
    ),
    Scenario(
      "applying_on_behalf_of_a_neighbor",
      "Nobody in the list is the person filling in the form — the case that made isSelf a real question.",
      graph => {
        // who-is-applying.html's "One or more people" option means the filer need not be in the
        // household at all, so /flowNobodyMarkedAsSelf must stay quiet here. It excludes this case
        // by construction rather than by the filer remembering to add themselves.
        screener(graph, Set("foodAssistance", "healthcare"), "35203", Some(1100))
        graph.set("/applyingFor", FgEnum("oneOrMorePeople", "/applyingForOptions"))
        mailingAddress(graph, "1901 6th Avenue North", "Birmingham", "AL", "35203")
        contact(graph, "(205) 555-0188", "helper@example.com")
        val elder = person(
          graph,
          personId(6, 1),
          "Ruth",
          "Callender",
          "1948-08-05",
          "female",
          "417-22-9061",
          relationship = Some("unrelated"),
          isSelf = false,
          incomeTypes = Set("socialSecurity"),
        )
        graph.set(s"$elder/otherIncomeAmount", Dollar(1100))
        graph.set(s"$elder/commonCases", MultiEnum(Set("medicalBills"), "/commonCaseOptions"))
        expenses(graph, 300, 720, 260, 640)
        signature(graph, "Alex Moreno")
      },
    ),
    Scenario(
      "lawful_permanent_resident_with_a_document",
      "A non-citizen with eligible immigration status, reached through the per-person follow-up the prototype hand-rolled.",
      graph => {
        // determine-who.html plus six personN-follow-up.html pages were an ascending iterator over
        // one per-person fact. All six shared the un-namespaced key alienNumberNumber; here the
        // path is per-item, so the collision cannot be written down.
        screener(graph, Set("healthcare"), "60622", None)
        graph.set("/applyingFor", FgEnum("meAndSomeoneElse", "/applyingForOptions"))
        mailingAddress(graph, "1620 West Division Street", "Chicago", "IL", "60622")
        contact(graph, "(312) 555-0154", "l.nowak@example.com")
        val filer = person(
          graph,
          personId(7, 1),
          "Lena",
          "Nowak",
          "1992-04-16",
          "female",
          "355-90-6612",
          relationship = None,
          isSelf = true,
          incomeTypes = Set("job"),
        )
        oneJob(graph, filer, "Wicker Park Dental", 2100, 70)
        val spouse = person(
          graph,
          personId(7, 2),
          "Andrzej",
          "Nowak",
          "1991-10-09",
          "male",
          "355-90-7724",
          relationship = Some("spouse"),
          incomeTypes = Set("job"),
        )
        oneJob(graph, spouse, "Ashland Auto Body", 1800, 76)
        graph.set(s"$spouse/isCitizen", false)
        graph.set(s"$spouse/hasEligibleImmigrationStatus", true)
        graph.set(s"$spouse/immigrationDocument", FgEnum("alienNumber", "/immigrationDocumentOptions"))
        graph.set(s"$spouse/immigrationDocumentNumber", "A123456789")
        expenses(graph, 2400, 1500, 620, 210)
        signature(graph, "Lena Nowak")
      },
    ),
    Scenario(
      "one_earner_with_three_jobs",
      "All three job slots in use — the prototype's own hard cap of three, and the reason jobs are slots rather than a nested collection.",
      graph => {
        screener(graph, Set("foodAssistance"), "30310", Some(2950))
        graph.set("/applyingFor", FgEnum("meAndSomeoneElse", "/applyingForOptions"))
        mailingAddress(graph, "1050 Ralph David Abernathy Boulevard", "Atlanta", "GA", "30310")
        contact(graph, "(404) 555-0131", "t.boateng@example.com")
        val filer = person(
          graph,
          personId(8, 1),
          "Tasha",
          "Boateng",
          "1993-02-25",
          "female",
          "588-31-4409",
          relationship = None,
          isSelf = true,
          incomeTypes = Set("job"),
        )
        graph.set(s"$filer/job1EmployerName", "Westview Elementary")
        graph.set(s"$filer/job1PayFrequency", FgEnum("twiceAMonth", "/payFrequencyOptions"))
        graph.set(s"$filer/job1Wages", Dollar(1400))
        graph.set(s"$filer/job1HoursPerPayPeriod", 60)
        graph.set(s"$filer/hasSecondJob", true)
        graph.set(s"$filer/job2EmployerName", "Peachtree Catering")
        graph.set(s"$filer/job2PayFrequency", FgEnum("weekly", "/payFrequencyOptions"))
        graph.set(s"$filer/job2Wages", Dollar(950))
        graph.set(s"$filer/job2HoursPerPayPeriod", 18)
        graph.set(s"$filer/hasThirdJob", true)
        graph.set(s"$filer/job3EmployerName", "Southside Rideshare")
        graph.set(s"$filer/job3PayFrequency", FgEnum("weekly", "/payFrequencyOptions"))
        graph.set(s"$filer/job3Wages", Dollar(600))
        graph.set(s"$filer/job3HoursPerPayPeriod", 12)
        person(
          graph,
          personId(8, 2),
          "Micah",
          "Boateng",
          "2016-11-14",
          "male",
          "588-31-5517",
          relationship = Some("child"),
        )
        expenses(graph, 150, 980, 540, 95)
        signature(graph, "Tasha Boateng")
      },
    ),
  )
