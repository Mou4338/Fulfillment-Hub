## AI usage note

# Tools used and how

Claude (Anthropic) was the only AI tool I used. I used it as a coding assistant and as a source of information while learning what the project needed. It helped me write code, explain warehouse and e-commerce concepts, and debug. The direction, design and decisions were mine.

# What I did with it

Fixed bugs and errors. I tested the app, found problems in the generated code, and had them corrected.
Set the design. I chose a clear, user-friendly, classic look that suits both warehouse staff and office staff.
Analysed the processing and reorder problems. I worked out what was going wrong in these areas and built the Processing desk and Reorders pages around it.
Analysed the staging and shipment problems. I made Staging and Ready to hand over separate pages, each with only the functions the job needs.
Rebuilt Inventory. I redid it with proper features and joined Reorders and Receiving to it, so that buying, receiving and putting away stock flow into one another.
Added the Guide and glossary. This page explains every screen, feature and workflow in plain language, so a new user doesn't have to leave the app.
Made the architectural and technical decisions. These include the business rules, the split between Office and Warehouse roles, the service-layer structure and the scope of the app. AI can suggest options, but it can't decide what fits this business.

# Where I changed the AI's approach

Action Queue. The first version added a row for every waiting priority order and every missed pickup. That pushed real blockers off the screen. I had it regrouped and scored, with one row per order showing only its most important reason.
Wrong-label scan. The first version raised an error, which rolled back the transaction and lost the record of the mistake. I had it changed so a wrong scan is saved as a normal result, and only real rule violations are rejected.

# What I verified myself

I ran the backend tests, walked through the full demo, checked the "Why is this blocked?" messages against the real inventory numbers, and checked the layout at phone width.