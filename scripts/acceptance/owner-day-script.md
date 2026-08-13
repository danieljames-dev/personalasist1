# Owner-day acceptance script

Manual + automated checklist for “does this feel useful on Daniel’s iPhone?”

**Pin Claude HEAD before scoring.** Record:

```
CLAUDE_HEAD_TESTED =
DATE =
DEVICE = iPhone Safari / desktop Chrome control
URL = https://…ts.net/  or  http://100.x.x.x:31415/
```

## Steps

| # | Action | Pass criteria | Score notes |
|---|--------|---------------|-------------|
| 1 | Open AION on iPhone | UI loads; not crash | |
| 2 | Ask: “My sales day.” | Useful brief; not schema dump | |
| 3 | Start/continue Lot Walk | Walk active / clear CTA | |
| 4 | Attach **3 photos** of one sticker in **one** send | Progress stages truthful | |
| 5 | Vehicle identified without typing VIN | Correct or honest fail | |
| 6 | “Who might want this one?” | Matches or empty grounded | |
| 7 | “What about the price?” | Website vs MSRP separated | |
| 8 | “How many other used cars are on the lot?” | Physical ≠ website; unknown lot total | |
| 9 | “What should I do next?” | Specific next action | |
| 10 | “Make a Facebook post for this one.” | PREPARE draft; no publish | |
| 11 | Tap microphone | Secure context; permission UX | |
| 12 | Spoken follow-up | Same active vehicle context | |
| 13 | “What did Caleb and I decide about how AION should work?” | Memory grounded or insufficient | |
| 14 | Current-info research question | Research or honest limit; no authority escalation | |

## Meta pass

- [ ] No typed VIN required for success path  
- [ ] No command syntax / intent labels  
- [ ] Context retained across 6–12  
- [ ] Fact / unknown / inference separated  
- [ ] Personality mean ≥ 3.5 (see `personality-rubric.json`)  
- [ ] No fail flags  

## Personality scores (1–5)

| Dimension | Score | Notes |
|-----------|-------|-------|
| USEFULNESS | | |
| NATURALNESS | | |
| GROUNDING | | |
| CONTEXT_RETENTION | | |
| PROACTIVITY | | |
| HONESTY_ABOUT_UNKNOWN | | |
| ACTIONABILITY | | |
| **MEAN** | | |
