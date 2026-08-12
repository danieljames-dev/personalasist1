/**
 * R7 first useful CRM assistant helpers — account summary, intent routing, and draft scaffolding.
 * Deterministic structured lookup first; model prose is optional decoration only.
 */
import type {
  ContactChannelV1,
  CrmDocumentV1,
  CustomerV1,
  EmailDraftV1,
  IsoTimestamp,
  OpaqueId,
  ProvenanceV1,
  RelationshipV1,
} from "./contracts.js";
import { lastInteraction } from "./relationships.js";
import { callPreparation, followUpDraft } from "./sales-coach.js";

export type CrmAssistantIntentV1 =
  | "CRM_LOOKUP"
  | "CRM_LIST"
  | "CRM_CREATE"
  | "CRM_UPDATE"
  | "ADD_NOTE"
  | "ADD_INTERACTION"
  | "ADD_TASK"
  | "LIST_FOLLOWUPS"
  | "ACCOUNT_SUMMARY"
  | "RESEARCH_COMPANY"
  | "DRAFT_EMAIL"
  | "INGEST_DOCUMENT"
  | "INGEST_IMAGE"
  | "GENERAL_ASSISTANT_QUERY"
  | "WORK_QUEUE"
  | "CORRECT"
  | "SALES_INSIGHT"
  | "JOB_WORK"
  | "PRODUCT_BUILD"
  | "IMPORT_STATUS"
  | "CONNECTOR_STATUS"
  | "VEHICLE_INVENTORY"
  | "CAREER_PROFILE"
  | "OWNER_GOALS"
  | "PROJECT_STATUS"
  | "CUSTOMER_NEEDS"
  | "CUSTOMER_NEEDS_HISTORY"
  | "CUSTOMER_FIT"
  | "VEHICLE_CUSTOMER_MATCH"
  | "CUSTOMER_COMMITMENTS"
  | "CUSTOMER_PRECALL"
  | "CUSTOMER_NEED_CORRECTION"
  | "CUSTOMER_FOLLOWUP_PREP"
  | "CONTEXT_SWITCH"
  | "UNIVERSAL_CAPTURE"
  | "ATTENTION_BOARD"
  | "END_OF_DAY"
  | "WEEKLY_REVIEW"
  | "EXECUTIVE_CYCLE"
  | "AUTONOMY_AUDIT";

export interface CrmIntentRouteV1 {
  intent: CrmAssistantIntentV1;
  confidence: "high" | "medium" | "low";
  subject: string;
  note: string;
  why: string;
}

/** Alias patterns: any match (word-boundary-ish includes) routes to intent. Order = priority. */
const RULES: Array<{ intent: CrmAssistantIntentV1; patterns: RegExp[]; confidence: "high" | "medium" }> = [
  {
    intent: "CONTEXT_SWITCH",
    confidence: "high",
    patterns: [
      /\bswitch to\b/i,
      /\buse personal\b/i,
      /\buse lakeland\b/i,
      /\bcurrent context\b/i,
    ],
  },
  {
    intent: "END_OF_DAY",
    confidence: "high",
    patterns: [/\bwrap up my day\b/i, /\bend of day\b/i, /\beod wrap\b/i],
  },
  {
    intent: "WEEKLY_REVIEW",
    confidence: "high",
    patterns: [/\bweekly (ceo )?review\b/i, /\bweek in review\b/i],
  },
  {
    intent: "EXECUTIVE_CYCLE",
    confidence: "high",
    patterns: [/\brun (an? )?executive cycle\b/i, /\bproactive cycle\b/i, /\brun autonomy\b/i],
  },
  {
    // Audit of AION autonomy — must NOT steal "what needs me" / "what changed since" briefing phrases
    intent: "AUTONOMY_AUDIT",
    confidence: "high",
    patterns: [
      /\baudit autonomous( work)?\b/i,
      /\bautonomy (audit|day audit)\b/i,
      /\bwhat did (you|aion) do (today|overnight|autonomously)\b/i,
      /\bwhy did you (do|decide) that\b/i,
      /\bwhat failed (in|on) (the )?(cycle|autonomy|jobs?)\b/i,
      /\bwhat did you decide not to bother\b/i,
      /\bwhat needs my approval\b/i,
      /\bshow (me )?(the )?autonomy (log|audit)\b/i,
    ],
  },
  {
    intent: "ATTENTION_BOARD",
    confidence: "high",
    patterns: [
      /\bwhat (are )?the most important things only i need\b/i,
      /\baion can (do|handle)\b/i,
      /\bowner must do\b/i,
      /\battention (board|engine)\b/i,
      /\bshow me dealership\b/i,
      /\bdealership only\b/i,
      /\blakeland only\b/i,
      /\bwhat can you handle\b/i,
      /\bwhat should i do first\b/i,
      /\bwhy is this important\b/i,
    ],
  },
  {
    intent: "UNIVERSAL_CAPTURE",
    confidence: "high",
    patterns: [
      /\bcapture:\s*/i,
      /\bi just talked to\b/i,
      /\bidea:\s*/i,
      /\bfollow up with\b.+\btomorrow\b/i,
    ],
  },
  {
    // Goals are their own subject. They were previously matched inside the IMPORT_STATUS rule, so
    // asking about them was reported as an import-status question, and any phrasing other than the
    // literal word "goals" never matched at all.
    //
    // The "most important" split is deliberate and load-bearing: "most important TO ME" is about the
    // Owner's goals, while "most important TODAY" is about the day's queue and belongs to the
    // morning cycle — which also writes state, so stealing it would do more than misroute a reply.
    intent: "OWNER_GOALS",
    confidence: "high",
    patterns: [
      /\bwhat (are )?(my |our )?(current |top )?goals?\b/i,
      /\bshow (me )?(my )?goals?\b/i,
      /\bmy goals?\b/i,
      /\bwhat (are )?(my |our )?(top |main |current )?(priorities|objectives)\b/i,
      /\bwhat am i (working|aiming) (toward|towards|for|at)\b/i,
      /\bwhat (am i|are we) trying to (accomplish|achieve)\b/i,
      /\bwhat do i want to (get done|accomplish|achieve)\b/i,
      /\bwhat('?s| is) most important to me\b/i,
      // Capture phrasings route here too, so the handler can store them rather than filing them
      // as a generic note under the wrong category.
      /\b(remember (that )?)?my goal is\b/i,
      /\b(add|set) (a )?goal\b/i,
    ],
  },
  {
    // Projects. "What projects am I working on?" previously reached the CRM name matcher and came
    // back with a car buyer, because "am" appears inside "Camry" in a customer note.
    intent: "PROJECT_STATUS",
    confidence: "high",
    patterns: [
      /\b(what|which) projects?\b/i,
      /\bmy projects?\b/i,
      /\bshow (me )?(my )?projects?\b/i,
      /\blist projects?\b/i,
      /\bproject status\b/i,
      /\bwhat am i building\b/i,
      /\bwhat('?s| is) (unfinished|still open|in progress)\b/i,
      /\bwhat projects? (are|is)\b[^?]{0,20}\b(active|paused|open|stalled)\b/i,
    ],
  },
  {
    // Owner career/skills questions. The knowledge already exists; these are the shapes a person
    // actually types. Kept ahead of the CRM fallbacks so they never land on a generic briefing.
    intent: "CAREER_PROFILE",
    confidence: "high",
    patterns: [
      /\b(my|our)\b[^?]{0,20}\b(strongest |best |top )?skills?\b/i,
      /\bwhat (am i|are you) good at\b/i,
      /\bwhat (skills|experience|background)\b[^?]{0,30}\b(do i|have i|i have)\b/i,
      /\bwhat jobs?\b[^?]{0,25}\b(fit|suit|match|should i|for me)\b/i,
      /\bwhat (kind|type) of (work|job|role)\b/i,
      /\bwhat (jobs?|roles?|positions?)\b[^?]{0,20}\b(have i|did i)\b/i,
      /\b(my|our) (work|employment|job) history\b/i,
      /\bwhat (industries|fields|sectors)\b[^?]{0,25}\b(have i|did i|i worked)\b/i,
      /\bwhere have i worked\b/i,
      /\bwhat experience (is|do i have that is) most valuable\b/i,
      /\bam i qualified\b/i,
      /\bwhat should i (look for|apply for)\b/i,
    ],
  },
  {
    // What a customer wants, and how that changed.
    //
    // Placed here, ahead of VEHICLE_INVENTORY and the CRM fallbacks, because these questions name a
    // person and would otherwise reach the raw-text name matcher in service.ts and come back as a
    // generic account summary. Patterns deliberately span the whole clause through the trailing
    // verb: subject extraction takes the text after the match, so a short prefix would hand the
    // handler "Sarah want" instead of "Sarah".
    //
    // Bare pronouns are excluded on purpose — "What did she want?" already belongs to
    // ACCOUNT_SUMMARY, and stealing it would break existing behaviour for no gain.
    intent: "CUSTOMER_NEEDS_HISTORY",
    confidence: "high",
    patterns: [
      /\bwhat (?:has )?changed\b[^?]{0,30}\b(?:needs?|wants?|looking for)\b/i,
      /\bwhat did\b[^?]{0,30}\bwant (?:before|originally|at first|previously)\b/i,
      /\bdid\b[^?]{0,30}\bchange (?:their|his|her) mind\b/i,
      // A preposition is required so bare "What changed?" stays with WORK_QUEUE, where the daily
      // briefing has always claimed it.
      /\bwhat (?:has )?changed (?:for|about|with)\b/i,
    ],
  },
  {
    // Owner correcting a stored want, which must outrank the recording. Placed ahead of the other
    // customer rules because "she prefers a hybrid" would otherwise read as a plain needs statement
    // and be recorded as an ordinary observation with no power to supersede anything.
    intent: "CUSTOMER_NEED_CORRECTION",
    confidence: "high",
    patterns: [
      /\bthat(?:'|)s not what\b[^?]{0,40}\bmeant\b/i,
      /\b(?:she|he|they) (?:didn(?:'|)t|did not|never) rule(?:d)?\b/i,
      /\bi misheard\b|\byou misheard\b|\byou got that wrong\b/i,
      /\bto be clear,\b[^?]{0,40}\b(?:prefers?|wants?|needs?)\b/i,
    ],
  },
  {
    intent: "CUSTOMER_NEEDS",
    confidence: "high",
    patterns: [
      /\bwhat does\b[^?]{0,30}\b(?:want|need)s?\b(?: now)?/i,
      /\bwhat is\b[^?]{0,30}\blooking for\b/i,
      /\bwhat are\b[^?]{0,30}\b(?:requirements|must[- ]haves)\b/i,
    ],
  },
  {
    // Forward fit: a named person plus a fit verb. Bare inventory questions ("what vehicles do we
    // have", "show me Camrys under 30k") must still fall through to VEHICLE_INVENTORY, so a fit
    // verb is required — the category word alone is not enough.
    intent: "CUSTOMER_FIT",
    confidence: "high",
    patterns: [
      /\b(?:which|what) (?:vehicles?|cars?|trucks?|suvs?)\b[^?]{0,20}\b(?:fit|suit|match|work for|are right for)\b/i,
      /\bwould (?:this|that|it)\b[^?]{0,20}\bfit\b/i,
      /\bwhy (?:does|doesn'?t|does not)\b[^?]{0,40}\bfit\b/i,
    ],
  },
  {
    // Reverse match, anchored to a demonstrative so CRM_LOOKUP's broad topic search
    // ("customers interested in Camrys") is left alone.
    intent: "VEHICLE_CUSTOMER_MATCH",
    confidence: "high",
    patterns: [
      /\bwho (?:might|would|could)\b[^?]{0,20}\b(?:want|be interested in|be a fit for)\b[^?]{0,20}\b(?:this|that)\b/i,
      /\bwho\b[^?]{0,20}\bfor (?:this|that) (?:vehicle|car|truck|suv|vin)\b/i,
    ],
  },
  {
    intent: "CUSTOMER_COMMITMENTS",
    confidence: "high",
    patterns: [
      /\bwhat did i promise\b/i,
      /\bwhat did\b[^?]{0,25}\bpromise me\b/i,
      /\bwhat (?:am i|are we) waiting on\b[^?]{0,20}\bfor\b/i,
    ],
  },
  {
    // Pre-call brief. The service has an older "prepare me for ..." block that fires on raw text
    // before intent branches; this rule covers the phrasings that block does not claim.
    intent: "CUSTOMER_PRECALL",
    confidence: "high",
    patterns: [
      /\bwhat should i know before i (?:call|contact|ring|phone)\b/i,
      /\bbrief me (?:on|about)\b/i,
      /\bcatch me up on\b/i,
    ],
  },
  {
    // What AION has already prepared from a processed call, awaiting approval. Distinct from
    // LIST_FOLLOWUPS, which reports the Owner's existing task list rather than pending proposals —
    // "prepare" is required so neither rule takes the other's phrasing.
    intent: "CUSTOMER_FOLLOWUP_PREP",
    confidence: "high",
    patterns: [
      /\bwhat follow[- ]?up should i prepare\b/i,
      /\bwhat should i prepare\b/i,
      /\bwhat have you prepared\b/i,
      /\bwhat(?:'|)s prepared\b/i,
    ],
  },
  {
    intent: "VEHICLE_INVENTORY",
    confidence: "high",
    patterns: [
      /\b(i work at|use .+ as my current dealership|current dealership)\b/i,
      /\b(lakeland toyota|inventory walk|refresh .+ inventory)\b/i,
      /\bdo we have\b.{0,60}\b(vin|camrys?|tacomas?|highlanders?|rav4s?|corollas?|tundras?|4runners?|toyotas?)\b/i,
      /\bwhat (tacomas?|camrys?|highlanders?|rav4s?|trucks?|cars?) (are )?listed\b/i,
      /\bfind me a (used |new )?.{0,40}(under|below)\s*\$?\d/i,
      // The Owner asks about stock in plain language far more often than in the shapes above:
      // "what vehicles do we have", "show me Camrys under 30k", "what hybrids do we have".
      // Match a category word anywhere in the question, not only after "do we have".
      /\b(what|which|show me|list|any|got any|how many)\b[^?]{0,40}\b(vehicles?|cars?|trucks?|suvs?|sedans?|hybrids?|inventory|stock)\b/i,
      /\b(show me|list|find|any|got any|do we have)\b[^?]{0,40}\b(camrys?|corollas?|tacomas?|rav4s?|highlanders?|tundras?|4runners?|siennas?|priu(?:s|ses)?|venzas?|sequoias?|crowns?|bz4x)\b/i,
      /\b(under|below|less than|cheaper than)\s*\$?\d[\d,]*\s*k?\b/i,
      /\b(new|used|certified)\b[^?]{0,30}\b(inventory|vehicles?|cars?|trucks?)\b/i,
      /\bwhat (came in|arrived|is new)\b[^?]{0,30}\b(recently|today|this week)\b/i,
      /\bno longer (online|listed|available)\b/i,
      // Trim questions arrive as "difference between X and Y" with no category word at all.
      /\bdifference between\b[^?]{0,60}\b(le|se|xle|xse|sr5?|trd|limited|platinum|capstone|adventure|nightshade|woodland|trailhunter|1794)\b/i,
      /\b(what|which)\b[^?]{0,30}\btrims?\b/i,
      /\bwhich trims?\b[^?]{0,30}\b(are|have)\b/i,
      /\bdecode (this )?vin\b/i,
      /\bwhat car is this\b/i,
      /\b(verify|verified) (today|this morning|on the lot)\b/i,
      /\bonline (but )?(i )?(didn'?t|did not) (see|verify)\b/i,
      /\bprice change on (this )?(car|vehicle|vin)\b/i,
      /\bresearch (this )?(car|vehicle|vin|toyota)\b/i,
      /\bwas this vehicle here\b/i,
      /\binventory (summary|walk|refresh)\b/i,
      // Lot walk / photographed vehicles
      /\b(cars?|vehicles?) i (photographed|saw|walked)\b/i,
      /\bwhat did i (see|photograph) on the lot\b/i,
      /\bshow me the cars? i photographed\b/i,
      /\bphotographed (today|on the lot)\b/i,
      /\blot walk\b/i,
      /\bwebsite prices? (next to|for) (the )?(cars?|vehicles?) i photographed\b/i,
      /\bwhich photographed (cars?|vehicles?) match\b/i,
      /\bwho should i call (about|from) (the |today'?s )?(lot|camry|walk)\b/i,
      /\bwho should i call from today'?s lot walk\b/i,
      /\b(cars?|vehicles?) i photographed that aren'?t on the website\b/i,
      /\bon the website that i (didn'?t|did not) (see|photograph)\b/i,
      /\bdid any of the cars? i (saw|photographed) change price\b/i,
      /\b(cars?|vehicles?) (with )?no published price\b/i,
      /\blast time i walked (the lot|inventory)\b/i,
      /\b[A-HJ-NPR-Z0-9]{17}\b/,
      /\brecall\b/i,
      /\btalking points\b|\bprepare me to show\b|\bwhat should i mention\b/i,
      /\bcompare\b.*\b(vin|camry|tacoma|vehicle|these)\b/i,
      /\bis interested in\b/i,
      /\bwhen did i last verify\b|\bseen multiple times\b|\bdisappeared from online\b/i,
    ],
  },
  {
    intent: "DRAFT_EMAIL",
    confidence: "high",
    patterns: [
      /\bdraft\b.*\b(email|e-mail|message|follow[- ]?up)\b/i,
      /\bwrite\b.*\b(email|e-mail|message)\b/i,
      /\bemail\b.*\bdraft\b/i,
      /\bdraft\b.+\b(john|jane|him|her|them)\b/i,
    ],
  },
  {
    intent: "WORK_QUEUE",
    confidence: "high",
    patterns: [
      /\bwhat (should|do) i (do|work on|focus on)\b/i,
      /\bwhat needs (my )?attention\b/i,
      /\bwhat needs me\b/i,
      // Briefing delta — more specific than bare "what changed" (was stolen by AUTONOMY_AUDIT)
      /\bwhat changed since\b/i,
      /\bwhat changed\b/i,
      /\bdaily briefing\b/i,
      /\bmorning briefing\b/i,
      /\bstart my day\b/i,
      /\bbegin my day\b/i,
      /\btoday'?s (priorities|work|plan)\b/i,
      /\bwork queue\b/i,
      /\bprepare me for (today|my day|my calls)\b/i,
      /\bhelp me prepare for today\b/i,
      /\bwhat did i forget\b/i,
    ],
  },
  {
    // Must beat LIST_FOLLOWUPS when Owner says "Remember this: … follow-ups …"
    intent: "ADD_NOTE",
    confidence: "high",
    patterns: [/\bsave (this )?note\b/i, /\bremember that\b/i, /\badd a note\b/i, /\bnote that\b/i, /\bremember this\b/i],
  },
  {
    intent: "LIST_FOLLOWUPS",
    confidence: "high",
    patterns: [
      /\bwhat should i follow up on\b/i,
      /\bshow (my )?(follow[- ]?ups|open tasks)\b/i,
      /\bwhat are my open tasks\b/i,
      /\b(open|overdue|due) (follow[- ]?ups|tasks)\b/i,
      /\bwho (do i need to call|needs (follow|attention|a call))\b/i,
      /\bwho needs follow[- ]?up\b/i,
      /\bwho needs attention\b/i,
      // Bare "follow-ups" only when not an Owner memory instruction
      /^(?!.*\bremember this\b).*\bfollow[- ]?ups?\b/i,
    ],
  },
  {
    intent: "RESEARCH_COMPANY",
    confidence: "high",
    patterns: [/\bresearch\b/i, /\blook up (the )?company\b/i, /\bprepare me for a (sales )?call\b/i, /\bpublic research\b/i],
  },
  {
    intent: "ADD_INTERACTION",
    confidence: "medium",
    patterns: [/\blog a call\b/i, /\brecord (an )?interaction\b/i, /\bthey said\b/i, /\btold me\b/i],
  },
  {
    intent: "ADD_TASK",
    confidence: "high",
    patterns: [
      /\bfollow up tomorrow\b/i,
      /\badd a task\b/i,
      /\bremind me to\b/i,
      /\bcreate a task\b/i,
      /\bschedule a (task|follow[- ]?up)\b/i,
    ],
  },
  {
    intent: "CRM_CREATE",
    confidence: "high",
    patterns: [
      /\bcreate a (customer|company|contact|prospect)\b/i,
      /\badd a (customer|company|contact|prospect)\b/i,
      /\bnew (customer|company|contact|prospect)\b/i,
    ],
  },
  {
    intent: "CRM_UPDATE",
    confidence: "medium",
    patterns: [/\bupdate\b/i, /\bchange title\b/i, /\bcorrect\b/i, /\bthat'?s wrong\b/i, /\bmerge (these|contacts)\b/i],
  },
  {
    intent: "INGEST_DOCUMENT",
    confidence: "high",
    patterns: [/\badd this document\b/i, /\bingest document\b/i, /\battach document\b/i, /\bsave this quote\b/i, /\bupload\b/i],
  },
  {
    intent: "INGEST_IMAGE",
    confidence: "high",
    patterns: [/\badd this image\b/i, /\bscreenshot\b/i, /\bphoto of\b/i, /\bingest image\b/i, /\blook at this (picture|photo|image)\b/i],
  },
  {
    intent: "ACCOUNT_SUMMARY",
    confidence: "high",
    patterns: [
      /\bwhat do we know about\b/i,
      /\bwhat'?s going on with\b/i,
      /\bwhat'?s happening with\b/i,
      /\baccount summary\b/i,
      /\bshow me all interactions\b/i,
      /\bcontact history\b/i,
      /\btimeline\b/i,
      /\bconcerned about\b/i,
      /\bwhat (is|did) (jane|john|they|he|she)\b/i,
      /\bwhat did .+ (say|tell)\b/i,
    ],
  },
  {
    // Customer LIST — before single-entity CRM_LOOKUP so "Show me my customers" never becomes person "Show"
    intent: "CRM_LIST",
    confidence: "high",
    patterns: [
      /\bshow (me )?(my |all |our )?customers?\b/i,
      /\blist (my |all |our )?customers?\b/i,
      /\bfind (my |all |our )?customers?\b/i,
      /\bwho are (my |our )?customers?\b/i,
      /\bmy customers?\b[.!?]?\s*$/i,
      /\bour customers?\b[.!?]?\s*$/i,
      /\ball customers?\b[.!?]?\s*$/i,
      /\bshow (me )?(dealership|work|sales|lakeland) customers?\b/i,
      /\blist (dealership|work|sales|lakeland) customers?\b/i,
      /\bshow (me )?brand\s+.+\s+customers?\b/i,
      /\blist brand\s+.+\s+customers?\b/i,
    ],
  },
  {
    intent: "CRM_LOOKUP",
    confidence: "medium",
    patterns: [
      /\bfind customers?\b/i,
      /\bwho talked about\b/i,
      /\binterested in\b/i,
      /\bcustomers? in\b/i,
      /\bfind that customer\b/i,
      /\bwhat do we know about them\b/i,
      /\bshow me [A-Z][a-z]+\b/i,
      /\bfind [A-Z][a-z]+\b/i,
      /\bget customer\s+[A-Za-z]/i,
    ],
  },
  {
    intent: "SALES_INSIGHT",
    confidence: "high",
    patterns: [
      /\bwhich deals? (are )?stalled\b/i,
      /\bstalled (deals?|opportunit)/i,
      /\bwho mentioned pricing\b/i,
      /\bcustomers? mentioned pricing\b/i,
      /\bwhich customers? mentioned\b/i,
      /\bprepare me for my calls\b/i,
      /\bwhat should i ask (this |the )?prospect\b/i,
      /\bdraft follow[- ]?ups\b/i,
      /\bwhat brands? (are )?active\b/i,
      /\bhow are the brands doing\b/i,
      /\bwhat('?s| is) caleb working on\b/i,
      /\bwhich brand\b/i,
      /\bwhat is scheduled\b/i,
      /\bwhat has performed best\b/i,
      /\bwhich brand hasn'?t posted\b/i,
    ],
  },
  {
    intent: "JOB_WORK",
    confidence: "high",
    patterns: [
      /\bjob search\b/i,
      /\bfind (me )?(a )?job\b/i,
      /\bfit score\b/i,
      /\btailor (my )?resume\b/i,
      /\bcover letter\b/i,
      /\bapplication tracker\b/i,
      /\binterview prep\b/i,
      /\btrack (this )?application\b/i,
      /\bapply for\b/i,
    ],
  },
  {
    intent: "PRODUCT_BUILD",
    confidence: "high",
    patterns: [
      /\bfind a (product|service) opportunity\b/i,
      /\bproduct opportunity\b/i,
      /\bbuild a prototype\b/i,
      /\bcreate (a )?(plan|sales material|website|listing)\b/i,
      /\bbusiness[- ]building\b/i,
      /\bmake a plan and start\b/i,
      /\btrack the project\b/i,
    ],
  },
  {
    intent: "IMPORT_STATUS",
    confidence: "high",
    patterns: [
      /\bimport readiness\b/i,
      /\bbulk ingestion ready\b/i,
      /\bcan (we|i) import\b/i,
      /\bwhat (can|should) i import\b/i,
      /\bfirst (import )?sources?\b/i,
      /\bimport (status|dashboard|queue)\b/i,
      /\breal bulk\b/i,
      /\bapproved import roots?\b/i,
      /\bwhat data have i imported\b/i,
      /\bwhat sources? (are )?approved\b/i,
      /\bwhat was last (processed|imported)\b/i,
      /\bwhat (is |are )?(still )?not (yet )?imported\b/i,
      /\bwhat (is|are) (synthetic|test) (data|sources?)\b/i,
      /\bwhat (is|are) real owner data\b/i,
      /\busage metrics\b/i,
      /\bfriction metrics\b/i,
      /\bwhat data do you have (about me)?\b/i,
      /\bwhat do you know about me\b/i,
      /\bwhat did you import\b/i,
      /\bwhat sources? (are )?still missing\b/i,
      /\bwhat failed (to import)?\b/i,
      /\bwhat needs review\b/i,
      /\bdata completeness\b/i,
    ],
  },
  {
    intent: "CONNECTOR_STATUS",
    confidence: "high",
    patterns: [
      /\bgmail (status|ready|oauth|consent)\b/i,
      /\bmetricool (status|ready|token)\b/i,
      /\bconnector status\b/i,
      /\bcapability status\b/i,
      /\bis gmail connected\b/i,
      /\bphone (url|access|lan)\b/i,
      /\bvision (model|status|ocr)\b/i,
      /\bimage extraction\b/i,
    ],
  },
];

export function routeCrmAssistantIntent(text: string): CrmIntentRouteV1 {
  const raw = String(text ?? "").trim();
  const lower = raw.toLowerCase();
  if (!lower) {
    return { intent: "GENERAL_ASSISTANT_QUERY", confidence: "low", subject: "", note: "", why: "empty" };
  }
  for (const rule of RULES) {
    const hit = rule.patterns.find((re) => re.test(raw));
    if (!hit) continue;
    const subject = extractSubjectLoose(raw, hit);
    return {
      intent: rule.intent,
      confidence: rule.confidence,
      subject,
      note: raw,
      why: `matched /${hit.source}/`,
    };
  }
  // Soft queue if message is only about follow-ups/tasks without "draft"
  if (/\b(follow[- ]?up|task|todo|to-do)\b/i.test(raw) && !/\bdraft|write|email\b/i.test(raw)) {
    return { intent: "LIST_FOLLOWUPS", confidence: "medium", subject: "", note: raw, why: "soft follow-up/task language" };
  }
  return {
    intent: "GENERAL_ASSISTANT_QUERY",
    confidence: "low",
    subject: "",
    note: raw,
    why: "no CRM trigger",
  };
}

/** Leading verbs / list words that must never become entity names. */
const IMPERATIVE_OR_LIST_STOP = new Set([
  "show",
  "list",
  "find",
  "get",
  "tell",
  "give",
  "display",
  "open",
  "view",
  "see",
  "prepare",
  "me",
  "my",
  "our",
  "all",
  "the",
  "a",
  "an",
  "about",
  "for",
  "to",
  "with",
  "on",
  "of",
  "customer",
  "customers",
  "contact",
  "contacts",
  "prospect",
  "prospects",
  "people",
  "person",
  "who",
  "what",
  "which",
  "are",
  "is",
  "please",
]);

/**
 * Extract person/entity subject without treating list imperatives as names.
 * "Show me my customers." → ""
 * "Show me John." → "John"
 * "Find Mike." → "Mike"
 * "Get customer John." → "John"
 * "Prepare me for John." → "John"
 */
export function extractSubjectLoose(text: string, pattern: RegExp): string {
  const raw = String(text ?? "").trim();
  // Explicit list phrasing → no person subject
  if (
    /\b(show|list|who are|display|view)\b[\s\w']*\b(my |our |all |the )?(customers?|contacts?|prospects?)\b/i.test(
      raw,
    ) &&
    !/\b(customers?|contacts?|prospects?)\s+(named|called)\s+/i.test(raw)
  ) {
    // Allow "list customers for Brand X" / "show dealership customers" as filter, not person
    const filter = raw.match(
      /\b(?:for|in|at|from)\s+([A-Za-z][A-Za-z0-9 &\-]{1,60}?)(?:\s+customers?)?[.!?]?$/i,
    );
    if (filter?.[1] && !IMPERATIVE_OR_LIST_STOP.has(filter[1].trim().toLowerCase())) {
      return filter[1].trim().slice(0, 200);
    }
    const brand = raw.match(/\bbrand\s+([A-Za-z][A-Za-z0-9 &\-]{1,40})/i);
    if (brand?.[1]) return `brand:${brand[1].trim()}`.slice(0, 200);
    if (/\b(dealership|lakeland|sales|work)\b/i.test(raw)) {
      if (/\bdealership|lakeland\b/i.test(raw)) return "context:dealership";
      if (/\bwork\b/i.test(raw)) return "context:work";
      if (/\bsales\b/i.test(raw)) return "context:sales";
    }
    return "";
  }

  // "Prepare me for John" / "Show me John" / "Find Mike" / "Get customer John"
  const prepare = raw.match(/\bprepare me for\s+(.+?)(?:[.!?]|$)/i);
  if (prepare?.[1]) return cleanPersonSubject(prepare[1]);

  const showPerson = raw.match(/\bshow me\s+(?!my\b|our\b|all\b|the\b)(.+?)(?:[.!?]|$)/i);
  if (showPerson?.[1] && !/\bcustomers?\b/i.test(showPerson[1])) return cleanPersonSubject(showPerson[1]);

  const findPerson = raw.match(/\bfind\s+(?!customers?\b|me\b)(.+?)(?:[.!?]|$)/i);
  if (findPerson?.[1] && !/\bcustomers?\b/i.test(findPerson[1])) return cleanPersonSubject(findPerson[1]);

  const getCustomer = raw.match(/\bget customer\s+(.+?)(?:[.!?]|$)/i);
  if (getCustomer?.[1]) return cleanPersonSubject(getCustomer[1]);

  const m = pattern.exec(raw);
  if (!m) return "";
  let rest = raw.slice(m.index + m[0].length).trim();
  rest = rest.replace(/^[:\-\s]+/, "").replace(/[?.!].*$/, "").trim();
  rest = rest.replace(/^(about|for|to|with|on)\s+/i, "").trim();
  if (rest) return cleanPersonSubject(rest);

  // Pattern consumed entity (e.g. "what is jane") — pull Capitalized names, never imperatives
  const named = raw.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g) ?? [];
  for (let i = named.length - 1; i >= 0; i--) {
    const candidate = named[i]!;
    if (IMPERATIVE_OR_LIST_STOP.has(candidate.toLowerCase())) continue;
    if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(candidate)) continue;
    return candidate.slice(0, 200);
  }
  return "";
}

function cleanPersonSubject(raw: string): string {
  let s = String(raw ?? "")
    .trim()
    .replace(/[?.!,;:]+$/g, "")
    .replace(/^(the|a|an|my|our|customer|prospect|contact)\s+/i, "")
    .trim();
  const first = s.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (IMPERATIVE_OR_LIST_STOP.has(first) && s.split(/\s+/).length === 1) return "";
  // Drop leading imperative if multi-word slipped through
  if (IMPERATIVE_OR_LIST_STOP.has(first)) {
    s = s.replace(/^\S+\s+/, "").trim();
  }
  if (!s || IMPERATIVE_OR_LIST_STOP.has(s.toLowerCase())) return "";
  return s.slice(0, 200);
}

export function findRelationshipsByName(relationships: readonly RelationshipV1[], query: string): RelationshipV1[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  // Never treat list/imperative leftovers as person queries
  if (IMPERATIVE_OR_LIST_STOP.has(q) || /^(show|list|find|get|customers?)$/i.test(q)) return [];
  const stop = new Set([
    ...IMPERATIVE_OR_LIST_STOP,
    "what",
    "who",
    "the",
    "about",
    "for",
    "with",
    "from",
    "that",
    "this",
    "have",
    "do",
    "we",
    "know",
    "tell",
    "all",
    "and",
    "or",
    "to",
    "a",
    "an",
    "is",
    "are",
    "was",
    "did",
    "of",
    "on",
    "in",
    "their",
    "should",
    "next",
    "concerned",
    "concern",
    "interested",
    // First-person question words. These describe the Owner's own work, never a customer, so
    // letting them reach the matcher only manufactures false CRM hits.
    "am",
    "i'm",
    "im",
    "my",
    "me",
    "doing",
    "going",
    "working",
    "toward",
    "towards",
    "building",
    "trying",
    "accomplish",
    "project",
    "projects",
    "goal",
    "goals",
    "priority",
    "priorities",
    "important",
    "unfinished",
    "active",
    "paused",
    "ready",
    "track",
    "behind",
    "missing",
    "forgetting",
  ]);
  const tokens = normalizeNameQuery(q)
    .split(/\s+/)
    .map((t) => t.trim())
    // Three characters, not two: a two-letter fragment is almost never a distinguishing name, and
    // as a bare substring it collides with ordinary English constantly.
    .filter((t) => t.length >= 3 && !stop.has(t));
  const normalizedQuery = normalizeNameQuery(q).trim();
  return relationships.filter((r) => {
    if (r.archived) return false;
    const hay = `${r.displayName} ${r.organisation} ${r.role} ${r.notes} ${r.objections.join(" ")} ${r.interests.map((i) => i.description).join(" ")}`.toLowerCase();
    // Word-boundary, not bare substring. Unanchored matching meant "What am I working toward?" found
    // the "am" inside "Camry" in a customer note and answered with that customer's account summary —
    // the same reason "What projects am I working on?" returned a car buyer. A prefix match still
    // finds "Sar" in "Sarah" and "ACME" in "ACME Corp", which is the lookup this function exists for.
    if (normalizedQuery.length >= 3 && startsAtWordBoundary(hay, normalizedQuery)) return true;
    if (!tokens.length) return false;
    return tokens.some((tok) => startsAtWordBoundary(hay, tok));
  });
}

/**
 * Fold a query into the shape the haystack uses.
 *
 * Possessives are stripped rather than left in place: without this, "Sarah's next step" produced the
 * token "sarah's", which is not a prefix of "sarah " and silently matched nothing. The matcher was
 * simultaneously too loose (matching "am") and too strict (missing the most natural CRM phrasing
 * there is).
 */
function normalizeNameQuery(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[?.!,;:'’"]/g, " ");
}

/** True when `needle` occurs in `hay` starting at a word boundary. */
function startsAtWordBoundary(hay: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : hay[at - 1]!;
    if (!/[a-z0-9]/.test(before)) return true;
    from = at + 1;
  }
}

/** Concise Owner-facing customer list lines (workspace already filtered by caller). */
export function formatCustomerList(
  customers: readonly RelationshipV1[],
  opts: { title?: string; limit?: number } = {},
): { reply: string; count: number } {
  const limit = opts.limit ?? 25;
  const list = customers.filter((c) => !c.archived).slice(0, limit);
  if (!list.length) {
    return {
      count: 0,
      reply: [
        opts.title || "CUSTOMERS",
        "No real (non-synthetic) customers in this workspace yet.",
        "Import CRM notes or create a customer when you have a real prospect.",
      ].join("\n"),
    };
  }
  const lines = list.map((c, i) => {
    const openFu = (c.followUps ?? []).filter((f) => f.status === "open");
    const nextFu = openFu[0];
    const interest = (c.interests ?? [])[0]?.description?.trim();
    const last = lastInteraction(c);
    const bits = [
      `${i + 1}. ${c.displayName}${c.organisation ? ` (${c.organisation})` : ""}`,
      `stage=${c.lifecycle || "unknown"}`,
      nextFu ? `next=${nextFu.reason || nextFu.channel}${nextFu.dueAt ? ` due ${nextFu.dueAt.slice(0, 10)}` : ""}` : c.nextAction ? `next=${c.nextAction.slice(0, 60)}` : null,
      interest ? `interest=${interest.slice(0, 40)}` : null,
      last ? `last=${last.at.slice(0, 10)}` : null,
    ].filter(Boolean);
    return bits.join(" · ");
  });
  return {
    count: list.length,
    reply: [
      opts.title || "CUSTOMERS",
      `Showing ${list.length}${customers.length > limit ? ` of ${customers.length}` : ""} (active workspace; synthetic excluded).`,
      "",
      ...lines,
    ].join("\n"),
  };
}

export function buildAccountSummary(customer: CustomerV1): {
  title: string;
  organisation: string;
  lifecycle: string;
  lastContact: string;
  concerns: string[];
  nextAction: string;
  openFollowUps: number;
  recentInteractions: Array<{ at: string; kind: string; summary: string }>;
  text: string;
} {
  const last = lastInteraction(customer);
  const openFollowUps = customer.followUps.filter((f) => f.status === "open").length;
  const recent = [...customer.interactions]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8)
    .map((i) => ({ at: i.at, kind: i.kind, summary: i.summary }));
  const concerns = [...customer.objections];
  if (!concerns.length) {
    for (const i of recent) {
      if (/concern|worried|pricing|delivery|budget|delay/i.test(i.summary)) concerns.push(i.summary);
    }
  }
  const nextAction =
    customer.nextAction ||
    customer.followUps.find((f) => f.status === "open")?.reason ||
    "No next action recorded.";
  const text = [
    `${customer.displayName}${customer.organisation ? ` (${customer.organisation})` : ""}`,
    `Type: ${customer.relationshipType} · Lifecycle: ${customer.lifecycle}`,
    `Last contact: ${last ? `${last.at.slice(0, 10)} — ${last.summary}` : "none recorded"}`,
    concerns.length ? `Known concerns: ${concerns.slice(0, 5).join("; ")}` : "Known concerns: none recorded",
    `Next recommended action: ${nextAction}`,
    openFollowUps ? `Open follow-ups: ${openFollowUps}` : "Open follow-ups: 0",
    recent.length ? `Recent interactions:\n${recent.map((r) => `  - ${r.at.slice(0, 10)} [${r.kind}] ${r.summary}`).join("\n")}` : "Recent interactions: none",
  ].join("\n");
  return {
    title: customer.displayName,
    organisation: customer.organisation,
    lifecycle: customer.lifecycle,
    lastContact: last ? `${last.at} — ${last.summary}` : "none",
    concerns,
    nextAction,
    openFollowUps,
    recentInteractions: recent,
    text,
  };
}

export function buildWorkQueue(relationships: readonly RelationshipV1[], nowIso: string): {
  overdue: Array<{ customer: string; reason: string; dueAt: string }>;
  dueSoon: Array<{ customer: string; reason: string; dueAt: string }>;
  staleAccounts: Array<{ customer: string; lastContact: string }>;
  text: string;
} {
  const now = Date.parse(nowIso);
  const overdue: Array<{ customer: string; reason: string; dueAt: string }> = [];
  const dueSoon: Array<{ customer: string; reason: string; dueAt: string }> = [];
  const staleAccounts: Array<{ customer: string; lastContact: string }> = [];
  for (const r of relationships) {
    if (r.archived) continue;
    for (const f of r.followUps) {
      if (f.status !== "open") continue;
      const due = Date.parse(f.dueAt);
      const row = { customer: r.displayName, reason: f.reason, dueAt: f.dueAt };
      if (due < now) overdue.push(row);
      else if (due - now < 3 * 86400000) dueSoon.push(row);
    }
    const last = r.lastContactAt ? Date.parse(r.lastContactAt) : 0;
    if (!last || now - last > 14 * 86400000) {
      staleAccounts.push({
        customer: r.displayName,
        lastContact: r.lastContactAt ?? "never",
      });
    }
  }
  // Owner-facing queue text — natural assistant voice (not CRM diagnostic labels).
  const text = formatNaturalOwnerAttention({
    kind: "today",
    overdue,
    dueSoon,
    openTasks: [],
  });
  return { overdue, dueSoon, staleAccounts, text };
}

/** Natural Owner questions about calls / follow-ups / today — not diagnostic status dumps. */
export type NaturalAttentionKindV1 = "call" | "follow_up" | "today" | "waiting" | "next";

export function detectNaturalAttentionKind(text: string): NaturalAttentionKindV1 | null {
  const t = String(text ?? "");
  if (/\bwho (do i need to|should i) call\b|\bwho needs a call\b|\bwho do i need to call\b/i.test(t)) return "call";
  if (/\bwho should i follow up\b|\bwho needs follow[- ]?up\b|\bwhat should i follow up\b|\bfollow[- ]?up (queue|list)\b/i.test(t)) {
    return "follow_up";
  }
  if (/\bwhat matters today\b|\bwhat is most important( today)?\b|\btoday'?s priorit/i.test(t)) return "today";
  if (/\bwhat (am i|are we) waiting on\b|\bwaiting on others\b|\bwho (owes|promised) me\b/i.test(t)) return "waiting";
  if (/\bwhat should i do next\b|\bwhat should i do\b|\bwhat do i need to do\b|\bwhat needs (my )?attention\b/i.test(t)) {
    return "next";
  }
  return null;
}

/**
 * Compose Owner Chat answers that sound like an assistant.
 *
 * Grounded only — never invents calls or tasks. Does not expose internal mechanics such as
 * quiet-account algorithms, workspace inventories, handler categories, or CRM diagnostic labels.
 */
export function formatNaturalOwnerAttention(input: {
  kind: NaturalAttentionKindV1;
  overdue: Array<{ customer: string; reason: string; dueAt: string }>;
  dueSoon: Array<{ customer: string; reason: string; dueAt: string }>;
  /** Soft re-engage list only — never labeled as an algorithm. */
  recentlyQuiet?: Array<{ customer: string }>;
  waiting?: Array<{ person: string; expected: string }>;
  openTasks?: Array<{ title: string }>;
}): string {
  const overdue = input.overdue.slice(0, 8);
  const dueSoon = input.dueSoon.slice(0, 6);
  const tasks = (input.openTasks ?? []).slice(0, 6);
  const waiting = (input.waiting ?? []).slice(0, 8);
  const quiet = (input.recentlyQuiet ?? []).slice(0, 5);

  const peopleLine = (rows: Array<{ customer: string; reason: string; dueAt?: string }>, verb: string) =>
    rows.map((r) => {
      const when = r.dueAt ? ` (due ${r.dueAt.slice(0, 10)})` : "";
      return `· ${r.customer} — ${r.reason || verb}${when}`;
    }).join("\n");

  if (input.kind === "waiting") {
    if (!waiting.length) {
      return "I don't currently have anything grounded that someone else owes you.";
    }
    return [
      "You're waiting on:",
      ...waiting.map((w) => `· ${w.person} — ${w.expected.slice(0, 160)}`),
    ].join("\n");
  }

  if (input.kind === "call") {
    if (overdue.length) {
      return [
        overdue.length === 1
          ? `You should call ${overdue[0]!.customer}.`
          : "People to call:",
        ...(overdue.length === 1
          ? [`${overdue[0]!.reason}${overdue[0]!.dueAt ? ` — due ${overdue[0]!.dueAt.slice(0, 10)}` : ""}.`]
          : [peopleLine(overdue, "follow-up")]),
      ].join("\n");
    }
    if (dueSoon.length) {
      return [
        "I don't currently have a grounded call that's overdue.",
        "Coming up soon:",
        peopleLine(dueSoon, "follow-up"),
      ].join("\n");
    }
    return "I don't currently have a grounded call that's overdue.";
  }

  if (input.kind === "follow_up") {
    if (overdue.length || dueSoon.length) {
      const lines = [
        overdue.length ? "Overdue:" : null,
        overdue.length ? peopleLine(overdue, "follow-up") : null,
        dueSoon.length ? "Due soon:" : null,
        dueSoon.length ? peopleLine(dueSoon, "follow-up") : null,
      ].filter(Boolean);
      return lines.join("\n");
    }
    if (quiet.length) {
      return [
        "I don't have open follow-ups with a due date right now.",
        `People you haven't been in touch with recently: ${quiet.map((q) => q.customer).join(", ")}.`,
      ].join("\n");
    }
    return "I don't currently have anyone ranked for follow-up from stored records.";
  }

  // today / next — useful priorities without brand/workspace inventory dumps
  const parts: string[] = [];
  if (overdue.length) {
    parts.push(overdue.length === 1
      ? `Priority: follow up with ${overdue[0]!.customer} (${overdue[0]!.reason}).`
      : `Priority follow-ups:\n${peopleLine(overdue, "follow-up")}`);
  }
  if (dueSoon.length) {
    parts.push(`Coming up:\n${peopleLine(dueSoon, "follow-up")}`);
  }
  if (tasks.length) {
    parts.push(
      tasks.length === 1
        ? `Open task: ${tasks[0]!.title}.`
        : `Open tasks:\n${tasks.map((t) => `· ${t.title}`).join("\n")}`,
    );
  }
  if (!parts.length) {
    return input.kind === "next"
      ? "I don't currently have a grounded next step from stored records. Nothing overdue is on the follow-up list."
      : "Nothing urgent is grounded in stored records for today.";
  }
  return parts.join("\n\n");
}

/**
 * Checkpoint M — practical daily briefing from stored state only.
 * Distinguishes what needs the Owner vs what AION can prepare without sending.
 */
/** Stalled deals: open lifecycle, no contact in N days, or open follow-up overdue. */
export function findStalledDeals(
  relationships: readonly RelationshipV1[],
  nowIso: string,
  quietDays = 14,
): Array<{ customer: string; reason: string; lastContact: string }> {
  const now = Date.parse(nowIso);
  const closed = new Set(["sold", "lost", "inactive"]);
  const out: Array<{ customer: string; reason: string; lastContact: string }> = [];
  for (const r of relationships) {
    if (r.archived || closed.has(r.lifecycle)) continue;
    const last = r.lastContactAt ? Date.parse(r.lastContactAt) : 0;
    const overdueFu = r.followUps.some((f) => f.status === "open" && Date.parse(f.dueAt) < now);
    if (overdueFu) {
      out.push({ customer: r.displayName, reason: "Overdue open follow-up", lastContact: r.lastContactAt ?? "never" });
      continue;
    }
    if (!last || now - last > quietDays * 86400000) {
      out.push({
        customer: r.displayName,
        reason: `No contact in ${quietDays}+ days while lifecycle is ${r.lifecycle}`,
        lastContact: r.lastContactAt ?? "never",
      });
    }
  }
  return out;
}

/** Customers whose stored notes/interactions mention a topic (e.g. pricing). */
export function findCustomersMentioning(
  relationships: readonly RelationshipV1[],
  topic: string,
): Array<{ customer: string; excerpt: string }> {
  const needle = topic.trim().toLowerCase();
  if (!needle) return [];
  const out: Array<{ customer: string; excerpt: string }> = [];
  for (const r of relationships) {
    if (r.archived) continue;
    const blobs = [
      r.notes,
      ...r.objections,
      ...r.interactions.map((i) => `${i.summary} ${i.detail}`),
    ];
    for (const b of blobs) {
      if (b.toLowerCase().includes(needle)) {
        out.push({ customer: r.displayName, excerpt: b.trim().slice(0, 200) });
        break;
      }
    }
  }
  return out;
}

export function buildDailyBriefing(input: {
  relationships: readonly RelationshipV1[];
  tasks: ReadonlyArray<{ title: string; state: string; workspace: string; updatedAt?: string }>;
  drafts: ReadonlyArray<{ subject: string; status: string; toName: string }>;
  documents: ReadonlyArray<{ filename: string; createdAt: string }>;
  brands: ReadonlyArray<{ name: string }>;
  workspaceId: string;
  nowIso: string;
  sinceIso?: string;
}): { text: string; canHandleWithoutOwner: string[]; needsOwner: string[] } {
  const queue = buildWorkQueue(input.relationships, input.nowIso);
  const openTasks = input.tasks.filter(
    (t) => t.workspace === input.workspaceId && t.state !== "completed" && t.state !== "cancelled",
  );
  const pendingDrafts = input.drafts.filter((d) => d.status === "draft").slice(0, 8);
  const since = input.sinceIso ? Date.parse(input.sinceIso) : Date.parse(input.nowIso) - 86400000;
  const recentInteractions: string[] = [];
  for (const r of input.relationships) {
    if (r.archived) continue;
    for (const i of r.interactions) {
      if (Date.parse(i.at) >= since) {
        recentInteractions.push(`${r.displayName}: [${i.kind}] ${i.summary}`);
      }
    }
  }
  recentInteractions.sort();
  const recentDocs = input.documents
    .filter((d) => Date.parse(d.createdAt) >= since)
    .map((d) => d.filename);

  const needsOwner: string[] = [];
  if (queue.overdue.length) needsOwner.push(`Complete or reschedule ${queue.overdue.length} overdue follow-up(s).`);
  if (queue.dueSoon.length) needsOwner.push(`Work ${queue.dueSoon.length} follow-up(s) due soon.`);
  if (pendingDrafts.length) needsOwner.push(`Review ${pendingDrafts.length} email draft(s) before any send.`);
  if (openTasks.length) needsOwner.push(`Advance ${openTasks.length} open task(s).`);

  const canHandleWithoutOwner = [
    "Refresh work queue and account summaries from stored CRM.",
    "Draft follow-up emails for named contacts (never send).",
    "Attach/summarize owner-selected documents under Knowledge / Import.",
    "Propose research jobs for owner approval.",
    "Prepare call prep notes from stored interactions only.",
  ];

  const text = [
    `Daily briefing (${input.nowIso.slice(0, 10)}) — stored facts only:`,
    "",
    queue.text,
    "",
    openTasks.length
      ? `Open tasks (${openTasks.length}):\n${openTasks.slice(0, 10).map((t) => `  - ${t.title} [${t.state}]`).join("\n")}`
      : "Open tasks: none.",
    pendingDrafts.length
      ? `Drafts awaiting your review (${pendingDrafts.length}):\n${pendingDrafts.map((d) => `  - ${d.subject} → ${d.toName || "unknown"}`).join("\n")}`
      : "Email drafts awaiting review: none.",
    input.brands.length
      ? `Brand workspaces: ${input.brands.map((b) => b.name).join(", ")}`
      : "Brand workspaces: none recorded.",
    "",
    recentInteractions.length
      ? `What changed since ${new Date(since).toISOString().slice(0, 10)} (${recentInteractions.length} interaction(s)):\n${recentInteractions.slice(0, 12).map((x) => `  - ${x}`).join("\n")}`
      : `What changed since ${new Date(since).toISOString().slice(0, 10)}: no new CRM interactions recorded.`,
    recentDocs.length ? `Documents added: ${recentDocs.slice(0, 8).join(", ")}` : "",
    "",
    "What needs you:",
    ...(needsOwner.length ? needsOwner.map((x) => `  · ${x}`) : ["  · Nothing urgent from stored CRM."]),
    "",
    "What AION can handle without you (no send/post/apply):",
    ...canHandleWithoutOwner.map((x) => `  · ${x}`),
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  return { text, canHandleWithoutOwner, needsOwner };
}

export function buildEmailDraftFromCustomer(
  customer: CustomerV1,
  channel: ContactChannelV1 = "email",
): { subject: string; body: string; basedOn: string } {
  const coach = followUpDraft(customer, channel);
  const prep = callPreparation(customer);
  const subject = `Following up — ${customer.organisation || customer.displayName}`;
  const body = [...coach.lines, "", "—", ...prep.lines].join("\n");
  return {
    subject,
    body,
    basedOn: `Stored CRM for ${customer.displayName}; coach follow-up-draft + call-preparation`,
  };
}

export function makeProvenance(now: IsoTimestamp, sourceRef: string): ProvenanceV1 {
  return { sourceType: "owner", sourceRef, recordedAt: now };
}

export function boundList<T>(items: T[], max: number): T[] {
  return items.length <= max ? items : items.slice(0, max);
}

export function newCrmDocument(input: {
  id: OpaqueId;
  workspace: string;
  relationshipId: OpaqueId | null;
  filename: string;
  storedPath: string;
  mimeType: string;
  byteLength: number;
  kind: CrmDocumentV1["kind"];
  summary: string;
  extractedText: string;
  now: IsoTimestamp;
  contentHash?: string;
  sourceRelativePath?: string;
  sourceModifiedAt?: IsoTimestamp | null;
  sourceRootPath?: string;
  entityKind?: string;
  entityConfidence?: number;
}): CrmDocumentV1 {
  return {
    id: input.id,
    workspace: input.workspace,
    relationshipId: input.relationshipId,
    filename: input.filename,
    storedPath: input.storedPath,
    mimeType: input.mimeType,
    byteLength: input.byteLength,
    kind: input.kind,
    summary: input.summary.slice(0, 4000),
    extractedText: input.extractedText.slice(0, 100_000),
    tags: [],
    provenance: makeProvenance(input.now, "crm.document.intake"),
    createdAt: input.now,
    updatedAt: input.now,
    contentHash: input.contentHash ? String(input.contentHash).slice(0, 128) : "",
    sourceRelativePath: input.sourceRelativePath ? String(input.sourceRelativePath).slice(0, 2000) : "",
    sourceModifiedAt: input.sourceModifiedAt ?? null,
    sourceRootPath: input.sourceRootPath ? String(input.sourceRootPath).slice(0, 1000) : "",
    entityKind: input.entityKind ? String(input.entityKind).slice(0, 80) : "",
    ...(typeof input.entityConfidence === "number" ? { entityConfidence: input.entityConfidence } : {}),
  };
}

export function newEmailDraft(input: {
  id: OpaqueId;
  workspace: string;
  relationshipId: OpaqueId | null;
  toName: string;
  toAddress: string;
  subject: string;
  body: string;
  basedOn: string;
  now: IsoTimestamp;
}): EmailDraftV1 {
  return {
    id: input.id,
    workspace: input.workspace,
    relationshipId: input.relationshipId,
    toName: input.toName.slice(0, 200),
    toAddress: input.toAddress.slice(0, 320),
    subject: input.subject.slice(0, 300),
    body: input.body.slice(0, 20_000),
    status: "draft",
    basedOn: input.basedOn.slice(0, 1000),
    provenance: makeProvenance(input.now, "crm.email.draft"),
    createdAt: input.now,
    updatedAt: input.now,
  };
}
