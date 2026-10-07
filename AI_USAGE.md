# AI usage note

## Tools used and how

| Tool | What it was used for |
|---|---|
| **Claude (Anthropic), as an AI coding assistant** | I used Claude for implementation — writing the FastAPI backend, business-rule services, seed data, tests, and the Next.js frontend to a specification I directed — while I made the product decisions: which of the brief's problems to prioritize, which extra features to add or cut, the business rules and thresholds, the UI/UX approach for warehouse vs. office users, and reviewing and testing every screen. |
| None | Claude was the only AI tool used for this project. |

**How I worked with it:** I read the brief and decided which of the seven problems mattered most and why (see "Which problems I chose, and why" above), then asked for the backend rules and API first, followed by the frontend built against that API. I reviewed each screen for whether it felt right for a warehouse worker doing this on their feet versus an office user at a desk, ran the test suite, and walked through the demo end to end, fixing anything that felt off or overcomplicated.

## Moments where the AI's first approach was changed

These happened during the build and are visible in the code:

1. **The Action Queue was too noisy.** The first version added a row for *every* priority order waiting to be processed and *every* missed pickup. At the start of a shift that meant a dozen near-identical rows pushing the real blockers (a transfer that unblocks two orders, a stock-not-found report) off the list. I noticed this and asked for it to be grouped and scored instead: one grouped row for on-track priority orders waiting to be processed, one grouped row for missed pickups, and one row per order showing only its most important reason. *Principle: a to-do list that lists everything prioritises nothing.*

2. **A wrong label was being "forgotten".** The first packing check rejected a wrong label by raising an error — which rolled back the database transaction, silently discarding the issue and log entry that recorded the mistake. I caught that a wrong-label scan was being silently rolled back instead of recorded, and had it fixed so mistakes are saved and returned as a normal result, while pure rule violations (e.g. packing before picking) are rejected without side effects. *Principle: the point of prevention is also to learn how often it happens.*

3. **Deliberately left out.** Batch/wave picking, predictive "AI" risk scores and full authentication were considered and rejected — my own call, not a suggestion I was talked out of: with 2–3 pickers, bin-sorted pick lists are enough; every rule on screen should be explainable to a warehouse worker in one sentence; and demo roles show the permission model without the extra weight of a login system this project didn't need.

## My own judgement calls

- I noticed the Action Queue was drowning real blockers in near-duplicate rows and asked for it to be grouped and scored instead of listing every instance of a problem (see above).
- I caught that a wrong-label scan was being silently rolled back instead of recorded, and had that fixed so mistakes are logged, not lost (see above).
- I made the call to cut batch/wave picking, predictive risk scores and full authentication rather than build them — each one was a reasonable thing to add, but none of them served the seven problems in the brief as directly as the time I'd spend elsewhere, so I kept scope tight instead of letting the build sprawl.

## What I verified myself

I ran the backend test suite, walked the 5-minute demo end to end, checked the "Why is this blocked?" messages against the real inventory numbers, and checked the responsive layout at phone width, since the warehouse screens especially need to hold up on a small screen.
