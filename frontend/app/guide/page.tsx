"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  LuBookOpen, LuArrowRight, LuUsers, LuWorkflow, LuLayoutDashboard, LuListOrdered, LuShoppingBag, LuBoxes, LuInbox, LuWarehouse,
  LuPackageCheck, LuTruck, LuFlag, LuNotebookPen, LuChartColumn, LuSettings, LuSlidersHorizontal, LuCircleHelp, LuBan, LuPalette,
  LuFileText, LuChevronRight, LuShoppingCart, LuClipboardCheck, LuLayoutGrid, LuHandshake, LuSend, LuMousePointerClick, LuListChecks,
  LuGitBranch,
} from "react-icons/lu";
import { useMeta } from "@/lib/context";
import { cx } from "@/lib/format";
import { PageHeader } from "@/components/AppShell";
import { SearchInput } from "@/components/FilterBar";
import { BlockedChip, PriorityBadge, RiskBadge, SeverityBadge, StatusBadge } from "@/components/StatusBadge";


const SECTIONS = [
  { id: "start", label: "Start here" },
  { id: "journey", label: "Journey of an order" },
  { id: "pages", label: "Every page explained" },
  { id: "rules", label: "Rules the system follows" },
  { id: "colours", label: "Colours & badges" },
  { id: "statuses", label: "Order statuses" },
  { id: "glossary", label: "Glossary A–Z" },
  { id: "faq", label: "What to do when…" },
  { id: "not-built", label: "Not built yet (and why)" },
];

type JourneyStep = { icon: React.ComponentType<{ className?: string }>; title: string; desc: string };

const JOURNEY_STEPS: JourneyStep[] = [
  { icon: LuInbox, title: "Received", desc: "Arrives from Amazon, Flipkart, Myntra or the website." },
  { icon: LuListOrdered, title: "Processed", desc: "Checked, courier chosen, label made, stock reserved." },
  { icon: LuWarehouse, title: "Picking", desc: "Items collected from their bins." },
  { icon: LuPackageCheck, title: "Packing", desc: "Every item scanned, boxed, weighed, labelled." },
  { icon: LuLayoutGrid, title: "Staging", desc: "Box placed in its staging area." },
  { icon: LuHandshake, title: "Ready to hand over", desc: "Waiting for the courier." },
  { icon: LuSend, title: "Shipped", desc: "Courier took it — on a manifest." },
];

const JOURNEY_SIDE_ROADS: { label: string; desc: string; color: "amber" | "sky" | "red" }[] = [
  { label: "On hold", desc: "A processing check failed (address, duplicate, value or quantity).", color: "amber" },
  { label: "Waiting for stock", desc: "Processed, but Main doesn’t have enough available yet.", color: "sky" },
  { label: "Cancelled", desc: "Stopped by the office; any reserved stock is released.", color: "red" },
];

type PageDoc = {
  id: string;
  href: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  who: string;
  what: string;
  steps: string[];
  buttons: [string, string][];
  can?: string[];
  tip?: string;
};

const PAGES: PageDoc[] = [
  {
    id: "dashboard",
    href: "/",
    title: "Dashboard",
    icon: LuLayoutDashboard,
    who: "Office (the warehouse sees big buttons for each floor job instead)",
    what: "The control room: what is going wrong right now and what to do first.",
    steps: [
      "Read the Action Queue from the top — number 1 is the most urgent thing in the building.",
      "Press the button on a row to go straight to the fix.",
      "Glance at the pipeline: the amber box is the stage where most orders are waiting (the bottleneck).",
      "Click any number (KPI) to open the list behind it.",
    ],
    buttons: [
      ["Refresh", "Reloads every number now (it also refreshes by itself every half minute)."],
      ["KPI tiles", "Each tile opens the filtered list behind the number — e.g. Delayed opens the delayed orders."],
      ["Action Queue buttons (Process, Pick now, Transfer, Put away, Open handover, Review reorders…)", "Open the exact page and item that fixes that row."],
      ["Courier pickups rows", "Open Ready to hand over for that courier."],
    ],
    tip: "If you only have one minute, read the Action Queue.",
  },
  {
    id: "processing",
    href: "/processing",
    title: "Processing desk",
    icon: LuListOrdered,
    who: "Office",
    what: "New orders are checked, given a courier and reserved stock — strictly in queue order, so nobody decides which is next.",
    steps: [
      "Look at “What will happen” on each row: Stock ready, Will wait for stock, or Will be held.",
      "Press Process next (or Process N) — orders are always processed from the top.",
      "Deal with the side lists: On hold needs a decision; Waiting for stock shows the fix.",
    ],
    buttons: [
      ["Process next", "Processes the order at the top of the queue."],
      ["Process N", "Processes the next N orders, top to bottom. Each order is done on its own, so one problem never half-applies the batch."],
      ["Process selected", "Processes only the ticked orders — still in queue order."],
      ["Fix (waiting for stock)", "Opens the order so you can transfer or reorder the missing stock."],
      ["How this works", "Opens this guide."],
    ],
    tip: "Processing reserves stock. The order at the top gets stock first — that is why the order matters.",
  },
  {
    id: "orders",
    href: "/orders",
    title: "Orders & order details",
    icon: LuShoppingBag,
    who: "Office",
    what: "Every order, its stage, and whether it will make its ship-by time. Click a row for the full story.",
    steps: [
      "Filter by stage, priority, risk, courier, channel, issues or date — or search by order ID, customer, city or marketplace reference.",
      "Open an order: the progress bar shows where it is, “Why is this blocked?” explains any stop in numbers.",
      "Press the Next action button — it always does the single most useful thing for that order.",
    ],
    buttons: [
      ["Next action (e.g. Transfer 8 units, Stage package, Open handover)", "Does or opens the one step that moves this order forward."],
      ["Release hold", "Lets a held order continue after you checked it (a note is required)."],
      ["Change courier", "Picks another courier; the parcel’s lane and pickup time move with it."],
      ["Cancel order", "Stops the order and releases its stock. Picked items get a Return to Shelf task."],
      ["All orders", "Back to the list with your filters kept."],
    ],
  },
  {
    id: "inventory",
    href: "/inventory",
    title: "Inventory & bins",
    icon: LuBoxes,
    who: "Office (the warehouse can view it)",
    what: "How much stock is where — bin by bin, in walking order — and which bins need refilling.",
    steps: [
      "Fix Stock blocking orders first — each row shows the fastest fix.",
      "Then the Transfer required list: bins below half in Main that Secondary can refill.",
      "Use Bins in order to walk an aisle, or Stock list to filter and sort.",
      "Mark transfers Sent and Received at Main as the stock moves.",
    ],
    buttons: [
      ["Transfer N", "Requests a transfer from Secondary to Main for that SKU (units are held in Secondary straight away)."],
      ["Create all N transfers", "Requests every suggested preventive transfer in one go."],
      ["Mark sent", "The transfer left the Secondary Warehouse."],
      ["Received at Main", "The stock is on the Main shelf — waiting orders get it automatically."],
      ["Adjust", "Sets the counted on-hand after a physical count, with a reason (office only)."],
      ["Capacity ✎", "Changes how many units a bin holds — the “below half” line follows it."],
      ["Reorder / Reorder from supplier", "Opens Reorders with that SKU ticked — neither warehouse has enough."],
      ["On order / Put away links", "Open the reorder or the delivery that is bringing the stock."],
    ],
    tip: "Refill when the bar crosses the dashed line — don’t wait until the bin is empty.",
  },
  {
    id: "reorders",
    href: "/reorders",
    title: "Reorders",
    icon: LuShoppingCart,
    who: "Office creates and changes reorders; the warehouse can see them",
    what: "Buying more stock from suppliers — what needs ordering, what is on the way, and what actually arrived.",
    steps: [
      "Needs reordering lists SKUs whose total stock is below the reorder point. Tick the ones to buy; check quantity and supplier.",
      "Pick where it should arrive (Main or Secondary) and the expected date, then press Order selected — one reorder per supplier.",
      "Each reorder becomes an expected delivery on Receiving. When it arrives, press Count arrival.",
      "Watch the progress bar: arrived OK, damaged, not coming, still due.",
    ],
    buttons: [
      ["Tick all / Clear", "Selects or clears every suggestion."],
      ["Order N selected", "Places the ticked suggestions as reorders (asks you to confirm first)."],
      ["New reorder", "Orders any SKU by hand from one supplier."],
      ["Count arrival (IN-…)", "Opens that delivery on Receiving to count it."],
      ["Put away N", "Opens the counted delivery so the stock can be shelved."],
      ["Change date", "The supplier gave a new date — moves every delivery still due."],
      ["Cancel", "Nothing has arrived yet and it isn’t coming — removes the expected delivery."],
      ["Close — rest not coming", "Part arrived and the rest never will — records the rest as not coming."],
    ],
    tip: "Order before the Secondary Warehouse runs dry — once it is empty a transfer can’t save a blocked order.",
  },
  {
    id: "receiving",
    href: "/receiving",
    title: "Receiving",
    icon: LuInbox,
    who: "Warehouse and office",
    what: "Every delivery — reorders, the rest of a reorder, and stock nobody expected: count it, then put it on a shelf.",
    steps: [
      "Open the delivery under To count. For every item enter how many arrived and how many of those are damaged.",
      "If something didn’t arrive choose Still coming (a follow-up delivery is created) or Not coming (closed + issue).",
      "Tick “Put the good units away now” to shelve it in the same step — or Put away later.",
      "Press Confirm. Waiting orders get the stock and the reorder is updated automatically.",
    ],
    buttons: [
      ["Everything arrived", "Fills every line with the expected quantity."],
      ["All OK / Not arrived (per line)", "Sets that line to the expected quantity, or to zero."],
      ["− / +", "Change a number by one (easy with gloves or on a phone)."],
      ["Confirm — all arrived OK / Confirm count", "Saves the count. If it doesn’t match, you see a summary to check first."],
      ["Put away N / Put away all N", "Shelves the good units (type a different, empty bin if needed). Only then can they be sold."],
      ["Correct", "Fixes a count after confirming, with a reason. Stock waiting for put-away changes automatically."],
      ["Log a new arrival", "Records stock that turned up without an expected delivery."],
    ],
    tip: "Stock can’t be sold until it is put away — tick “put away now” when you shelve it straight off the truck.",
  },
  {
    id: "picking",
    href: "/picking",
    title: "Picking",
    icon: LuWarehouse,
    who: "Warehouse",
    what: "Collect the items for one order from the shelves.",
    steps: [
      "Open the top order in the queue (priority first). The card says which bin to start at.",
      "Walk the bins in the order listed and tap Picked for each item.",
      "When everything is picked, go to packing.",
    ],
    buttons: [
      ["Picked", "You have the item in your hand. Stock is taken off the shelf exactly once."],
      ["Can’t find it", "Opens a Stock Not Found issue for the office. Stock is not changed silently."],
      ["Damaged", "Opens a Damaged Item issue for that unit."],
      ["Print pick list", "Paper copy in walking order."],
      ["Go to packing", "Opens this order at the packing station."],
    ],
  },
  {
    id: "packing",
    href: "/packing",
    title: "Packing",
    icon: LuPackageCheck,
    who: "Warehouse",
    what: "Check every item with the scanner before it goes in the box, then check the label.",
    steps: [
      "Scan each unit (or type the SKU and press Enter). Wrong product, wrong size/colour or one too many is rejected in red.",
      "Choose the box type and enter the weight from the scale.",
      "Scan the label on the box and press Verify label & finish packing.",
      "Go on to Staging to put the parcel in its area.",
    ],
    buttons: [
      ["Scan", "Checks the scanned code against the order."],
      ["Start over", "Clears the scans for this order and starts again."],
      ["Verify label & finish packing", "Checks the label belongs to this order and the weight is sensible, then marks it Packed."],
      ["Next: place it at …", "Opens Staging with this parcel ready to stage."],
      ["Next order", "Opens the next order waiting at the packing station."],
    ],
  },
  {
    id: "staging",
    href: "/staging",
    title: "Staging",
    icon: LuLayoutGrid,
    who: "Warehouse and office",
    what: "Every packed box gets a known place until the courier takes it. Eight areas: one lane per courier plus four shared areas.",
    steps: [
      "Under To stage, each packed parcel shows where it should go and why.",
      "Put the box there and press Stage at … (one tap). Or press Choose area to pick another place.",
      "The parcel now appears on Ready to hand over.",
      "Open any area card to see what is in it; use Move to put a parcel somewhere else.",
    ],
    buttons: [
      ["Stage at …", "Records the parcel in its suggested area in one tap."],
      ["Choose area", "Shows every area with what it is for and how full it is. Another courier’s lane needs an extra tick — that driver could take the wrong parcel."],
      ["Area cards (Open / Hide)", "Show the parcels in that area, whether each can leave, and a Move button."],
      ["Move", "Puts a staged parcel in a different area (e.g. onto the hold rack, or back to its lane)."],
      ["Find a package", "Type a package, order or label — it tells you exactly where the box is."],
      ["Ready to hand over", "Opens the next step."],
    ],
    can: [
      "Courier lanes (Lane 1 · Delhivery, Lane 2 · BlueDart, Lane 3 · XpressBees, Lane 4 · Shadowfax) — that courier’s parcels only.",
      "Priority Shelf P-01 — priority parcels for any courier, kept apart so they go first.",
      "Dispatch Zone 1 and 2 — overflow for any courier when a lane is full.",
      "Rack B-04 (hold rack) — parcels that must NOT go out yet (open issue, re-label, cancelled). Never handed over from here.",
    ],
    tip: "The suggestion follows simple rules: blocked → hold rack; priority → priority shelf; otherwise the courier’s lane, or overflow if the lane is full.",
  },
  {
    id: "handover",
    href: "/handover",
    title: "Ready to hand over",
    icon: LuHandshake,
    who: "Warehouse and office (only the office changes the handover mode)",
    what: "Staged parcels grouped by courier. When the courier arrives, hand the parcels over — by hand or automatically — and each order becomes Shipped.",
    steps: [
      "Each courier card shows the next pickup, the parcels ready to leave (with where to collect them) and the ones that can’t leave yet (and why).",
      "When the courier arrives press Courier arrived.",
      "Manual courier: a checklist opens with every ready parcel ticked, grouped by area. Collect them, untick anything not taken, press Hand over.",
      "Automatic courier: confirm once and every ready parcel is handed over. Blocked parcels stay behind.",
      "A manifest (proof of handover) opens — print it for the driver to sign.",
    ],
    buttons: [
      ["Courier arrived", "Records the courier’s arrival and starts the handover in that courier’s mode."],
      ["Hand over N ticked", "Hands over only the parcels you ticked in the table (without the checklist)."],
      ["Handover mode (office)", "Manual · Automatic when the courier arrives · Automatic at pickup time."],
      ["Can’t leave yet ▾", "Shows the parcels held back and why; Stage it / Open in Staging fixes them."],
      ["Manifest link", "Opens the last manifest for that courier."],
    ],
    can: [
      "Manual — someone ticks what the courier takes. Safest when drivers often leave parcels behind.",
      "Automatic when the courier arrives — pressing Courier arrived hands over every ready parcel at once.",
      "Automatic at pickup time — for couriers who always come on schedule: at each pickup time the system hands over every parcel that was ready. A courier who comes early can still be recorded with Courier arrived.",
      "“Courier is here” shows for 45 minutes after an arrival is recorded.",
    ],
    tip: "Parcels on the hold rack, not yet staged, or with a blocking issue are never handed over — automatic or not.",
  },
  {
    id: "shipped",
    href: "/shipped",
    title: "Shipped",
    icon: LuSend,
    who: "Everyone",
    what: "Everything that has left the building: which parcel, which courier, when, on which manifest, and whether it went by hand or automatically.",
    steps: [
      "Choose Today, Yesterday, Last 7 days or All, and a courier if you like.",
      "Search for a package, order, customer, city or manifest.",
      "Switch between Parcels, Manifests and Courier visits.",
    ],
    buttons: [
      ["Today / Yesterday / Last 7 days / All", "The period to show."],
      ["Manifest ID / View & print", "Opens the manifest — the signed proof of what the courier took."],
      ["Order ID", "Opens the order with its full timeline."],
      ["Courier visits", "Every recorded courier arrival: how many parcels they took and how many were left behind."],
    ],
    tip: "“By hand” = a person ticked the parcels. “Auto · on arrival” / “Auto · pickup time” = handed over automatically.",
  },
  {
    id: "issues",
    href: "/issues",
    title: "Issues",
    icon: LuFlag,
    who: "Everyone reports; the office resolves most types",
    what: "Every problem on the floor becomes a tracked record with an owner and a history — nothing gets forgotten.",
    steps: [
      "Needs action shows open issues, most serious first. Filter by type or severity.",
      "Open an issue, press Start working on it so others know, then fix the problem.",
      "Press Resolve with a short note of what was done.",
    ],
    buttons: [
      ["Report issue", "Records a new problem (type, severity, order/package/SKU, blocks the order or not)."],
      ["Start working on it", "Moves the issue to In progress with you as owner."],
      ["Resolve", "Closes it with a note. Some types do the fix too (e.g. Return to Shelf puts stock back)."],
      ["Found it on recount / Item is fine", "Stock problem was a false alarm — the item can be picked again."],
      ["Confirm missing & adjust stock / Write off damaged unit", "The unit really is gone — stock is corrected and the order waits for more."],
      ["Substitute variant", "Replace with another variant of the same product (only substitutable products)."],
      ["Cancel order", "Stops the order from the issue."],
    ],
  },
  {
    id: "analytics",
    href: "/analytics",
    title: "Analytics",
    icon: LuChartColumn,
    who: "Office",
    what: "A few numbers that show where fulfillment slows down — from the same data the team works on.",
    steps: ["Check received vs shipped per day, orders by stage, the most common problems and courier pickup performance."],
    buttons: [["(No buttons)", "Read-only charts and tables."]],
  },
  {
    id: "activity",
    href: "/activity",
    title: "Activity records",
    icon: LuClipboardCheck,
    who: "Everyone",
    what: "The permanent record of every action: who did it, when, and to which order, parcel or issue. Records can't be edited or deleted.",
    steps: [
      "Pick a person card to see only their records (or use My activity in the top-right menu).",
      "Narrow it down with the date tabs, the role, the area chips or the search box.",
      "Click an order, parcel or issue chip on any record to open it.",
    ],
    buttons: [
      ["My activity", "Shows only what you did."],
      ["Export CSV", "Downloads the records that match your filters (newest 1,000) for a spreadsheet."],
      ["Show more", "Loads the next 50 older records."],
    ],
    tip: "Switching between Office and Warehouse is recorded too, as “Signed in”.",
  },
  {
    id: "shift",
    href: "/shift",
    title: "Shift handover",
    icon: LuNotebookPen,
    who: "Everyone",
    what: "What the next shift needs to know, on one page.",
    steps: ["Read what was received and shipped this shift, work in progress, delayed orders, parcels staged and open issues.", "Write a note for the next shift and save it."],
    buttons: [["Save handover note", "Saves your note with a snapshot of the numbers."]],
  },
  {
    id: "settings",
    href: "/settings",
    title: "Settings & demo",
    icon: LuSettings,
    who: "Everyone",
    what: "Switch demo role, follow the 5-minute demo, see couriers and operating rules, reset demo data.",
    steps: ["Pick Office or Warehouse to see the app as that person.", "Follow the demo steps in order."],
    buttons: [
      ["Office / Warehouse", "Switches the demo role. The server enforces what each role may do."],
      ["Reset demo data", "Rebuilds everything relative to the current time (office only)."],
    ],
  },
  {
    id: "guide",
    href: "/guide",
    title: "Guide & glossary",
    icon: LuBookOpen,
    who: "Everyone",
    what: "This page: every page, button, rule and word in simple language.",
    steps: ["Type in the search box to find a word, a button or a page.", "Use the chips at the top to jump to a section."],
    buttons: [
      ["Open →", "Opens the page being described."],
      ["How this works (on other pages)", "Jumps to that page’s section here."],
    ],
  },
];

const GLOSSARY: { term: string; def: string; tag?: string }[] = [
  { term: "Action Queue", def: "The ranked to-do list on the Dashboard. Score = type of problem + 30 if priority + how close the deadline is + how severe it is." },
  { term: "After cutoff", def: "The order arrived after the daily cutoff time, so its ship-by moves to the next day. Shown honestly instead of hiding a late promise." },
  { term: "Aisle", def: "A row of shelves in the Main Warehouse, named by a letter (A, B, C…). It is the first part of a bin code." },
  { term: "Allocation", def: "Giving newly arrived stock to waiting orders. Always priority orders first, then the earliest ship-by." },
  { term: "Available", def: "On hand minus reserved. The only stock a new order can take. Available = on hand − reserved." },
  { term: "At risk", def: "Close to the ship-by time and not yet staged (3 h for priority, 6 h for normal), or a priority order that is blocked." },
  { term: "Awaiting put-away", def: "Received from a supplier and counted, but not on a shelf yet. It cannot be sold until it is put away." },
  { term: "Arrived OK / damaged / not arrived", def: "The three results of counting a delivery line. Arrived in total − damaged = OK units (these can be put away). Expected − arrived = not arrived." },
  { term: "Backorder / still coming", def: "Units that didn’t arrive but the supplier will still send. They move to a follow-up delivery (“Rest of a reorder”) with its own expected date." },
  { term: "Batch processing", def: "Processing several new orders with one click on the Processing desk. They are always processed top to bottom in queue order." },
  { term: "Bin", def: "One shelf location, e.g. A-01-02 = aisle A, bay 01, level 02. Each SKU has one bin in each warehouse." },
  { term: "Bin capacity", def: "How many units of that SKU fit in its bin. Used for the fill bar and for the “below half” rule. The office can change it." },
  { term: "Blocked", def: "The order can’t move on until something is fixed: on hold, waiting for stock, or a blocking issue. “Why is this blocked?” says exactly what." },
  { term: "Blocking issue", def: "An issue marked to stop the order from being packed or shipped until it is resolved." },
  { term: "Bottleneck", def: "The stage with the most orders waiting right now (at least 10). A fact, not a prediction." },
  { term: "Closed short", def: "A reorder that is finished but not everything arrived — some units were not coming or were damaged and not replaced." },
  { term: "Correct count", def: "Fixing a delivery count after it was confirmed, with a reason. Stock waiting for put-away is adjusted automatically." },
  { term: "Cancel", def: "Stops an order. Reserved stock is released. If items were already picked, a Return to Shelf task is created." },
  { term: "Capacity line / 50% line", def: "The dashed line on each fill bar. When available stock falls below it, a transfer is required." },
  { term: "Channel", def: "Where the order came from: Amazon, Flipkart, Myntra or the Website." },
  { term: "Automatic at pickup time", def: "Handover mode for couriers who always come on schedule: at each pickup time every parcel that was ready is handed over by the system." },
  { term: "Automatic when the courier arrives", def: "Handover mode: pressing Courier arrived hands over every ready parcel at once; parcels that can’t go stay behind." },
  { term: "Can’t leave yet", def: "A parcel for this courier that won’t be handed over: not staged, on the hold rack, or its order has a blocking issue. The reason is shown next to it." },
  { term: "Courier arrived", def: "The button to press when the driver is at the dock. It records the visit and starts the handover in that courier’s mode." },
  { term: "Courier is here", def: "Shown on a courier card for 45 minutes after their arrival was recorded." },
  { term: "Courier visit", def: "A recorded arrival of a courier: when, who recorded it, how many parcels were taken and how many were left behind." },
  { term: "Courier", def: "The delivery company (Delhivery, BlueDart, XpressBees, Shadowfax). Each has its own pickup times, cost, speed and staging lane." },
  { term: "Courier recommendation", def: "Only couriers that collect before ship-by are considered. Priority → fastest delivery; normal → cheapest. The reason is shown on the order." },
  { term: "Critical", def: "The most serious level. For stock: available is below a quarter of the bin. For issues: blocks shipping." },
  { term: "Cutoff", def: "Priority orders before 14:00 ship the same day; normal orders before 16:00 ship the next day." },
  { term: "Dispatch zone (overflow)", def: "Dispatch Zone 1 and 2 — shared areas for any courier, used when a lane is full. Parcels are handed over from here like from a lane." },
  { term: "Delayed", def: "The ship-by time has passed and the order has not shipped." },
  { term: "Duplicate order", def: "The same marketplace reference was imported twice. The copy is put on hold so it isn’t shipped twice." },
  { term: "FIFO (first in, first out)", def: "Among orders with the same priority and ship-by, the one received first is processed first." },
  { term: "Fill bar", def: "The bar next to each bin. Dark = available, grey = reserved (still in the bin), dashed line = the refill line." },
  { term: "Handover", def: "Giving staged parcels to the courier. Creates a manifest and marks the orders Shipped. Done on the Ready to hand over page, by hand or automatically." },
  { term: "Handover mode", def: "How a courier’s parcels leave: Manual (tick them), Automatic when the courier arrives, or Automatic at pickup time. Set per courier by the office." },
  { term: "Hold rack (Rack B-04)", def: "Shared staging area for parcels that must not go out yet — open issue, re-label, address check, cancelled order. Nothing is ever handed over from here." },
  { term: "Hold / On hold", def: "Processing stopped the order because a check failed (incomplete address, possible duplicate, unusual value or quantity). Someone must review it." },
  { term: "Issue", def: "A recorded problem with type, severity, owner, status and history." },
  { term: "KPI", def: "Key number at the top of the Dashboard. Every KPI is clickable and opens its list." },
  { term: "Label check", def: "At packing, the label on the box is scanned. A label for another order is rejected." },
  { term: "Lane / courier lane", def: "The floor area where one courier’s parcels wait, e.g. “Lane 2 · BlueDart”. Only that courier’s parcels belong there." },
  { term: "Left behind", def: "Parcels for a courier that could not go when the courier came (not staged, on hold, blocking issue). Shown on the courier visit." },
  { term: "Main Warehouse", def: "The warehouse that ships orders. Orders are only picked from here." },
  { term: "Manifest", def: "The list of parcels a courier took, with time, person and how (by hand or automatic). Proof of handover — print it for the driver to sign." },
  { term: "Manual handover", def: "When the courier arrives, a checklist opens with every ready parcel ticked. Untick anything the driver did not take, then press Hand over." },
  { term: "Move", def: "Putting a staged parcel in a different staging area. Recorded in the order’s timeline." },
  { term: "Missed pickup", def: "A parcel still in the building 15 minutes after its courier’s pickup. An issue is opened and the parcel moves to the next pickup." },
  { term: "Next action", def: "The one recommended step for an order, with a button that does it." },
  { term: "Not coming", def: "Units on a delivery that didn’t arrive and won’t be sent. Recorded on the reorder and logged as a Receiving Shortage issue." },
  { term: "On order", def: "Units on supplier deliveries that haven’t been counted yet. Counted in the stock position so the same SKU isn’t ordered twice." },
  { term: "On hand", def: "Units physically in the bin (as far as the system knows), including reserved ones." },
  { term: "Pick list", def: "The items of one order in walking order by bin." },
  { term: "Pipeline", def: "The row of stage boxes on the Dashboard: Received → Processed → Picking → Packing → Staging → Shipped." },
  { term: "Preventive transfer / refill", def: "Moving stock from Secondary to Main when a bin falls below half — before any order is blocked." },
  { term: "Priority shelf (P-01)", def: "Shared area for priority parcels of any courier, so they are handed over first and never buried under normal parcels." },
  { term: "Priority order", def: "An order promised faster delivery. Always first in every queue, and it gets stock first." },
  { term: "Processing", def: "The office step after an order arrives: checks (address, duplicate, value), courier choice, label, and stock reservation." },
  { term: "Put away", def: "Placing received stock into its bin and confirming it. Only then is it sellable." },
  { term: "Ready to hand over", def: "A staged parcel that can leave now: in a lane or shared area (not the hold rack) and with no blocking issue. Also the name of the page where couriers collect them." },
  { term: "Queue order", def: "Priority first → earliest ship-by → first received. Used on the Processing desk and in batch processing." },
  { term: "Reorder", def: "A purchase order to a supplier for one or more SKUs. It creates an expected delivery that is counted on the Receiving page. Statuses: Ordered → Partly received → Received / Closed short, or Cancelled." },
  { term: "Reorder point", def: "Half of the Main bin (the refill line) plus what waiting orders still need. When the stock position is below it, the SKU is suggested for reordering." },
  { term: "Reserved", def: "Units promised to an order (or to an outgoing transfer). Still on the shelf, but nobody else can take them." },
  { term: "Reservation (all-or-nothing)", def: "An order reserves every unit it needs, or none. Half-reserving would lock stock another order could ship today." },
  { term: "Return to Shelf", def: "A task created when a picked order is cancelled: put the items back in their bins, then confirm." },
  { term: "Risk", def: "On track, At risk or Delayed — worked out from the time left before ship-by." },
  { term: "Scan / verify", def: "Checking an item at packing by scanning its SKU barcode. Every unit must be verified before the box can be closed." },
  { term: "Secondary Warehouse", def: "Overflow storage. It doesn’t ship; stock is transferred to Main first." },
  { term: "Sellable", def: "Available in Main + available in Secondary." },
  { term: "Severity", def: "How serious an issue is: Low, Medium, High, Critical." },
  { term: "Ship-by", def: "The latest time the order must leave with a courier to keep the delivery promise." },
  { term: "Shortage / shortfall", def: "Waiting orders need more units than Main has available. Shortfall = how many are missing." },
  { term: "SKU", def: "Stock Keeping Unit — one exact product variant, e.g. TSH-014-BLU-M = Essential Cotton Tee, Blue, size M." },
  { term: "Staged", def: "Packed and placed in a known staging area, waiting for the courier. Staged parcels are listed on Ready to hand over." },
  { term: "Staging area", def: "Any place a packed parcel can wait: the four courier lanes, Priority Shelf P-01, Dispatch Zone 1 and 2 (overflow) and Rack B-04 (hold). Each has a capacity." },
  { term: "Stage at …", def: "The one-tap button on the Staging page that puts a parcel in its suggested area." },
  { term: "Shipped (page)", def: "The list of everything that left the building, with manifests and courier visits." },
  { term: "Stock position", def: "Everything you have or will have soon: available in Main + available in Secondary + waiting for put-away + on order." },
  { term: "Stock not found", def: "The picker couldn’t find the item in its bin. An issue is opened; stock isn’t changed until someone confirms." },
  { term: "Substitute", def: "Replacing a missing variant with another variant of the same product (only for products marked substitutable)." },
  { term: "Unplanned arrival", def: "Stock that turned up without an expected delivery (walk-in supplier, replacement, found stock). Recorded with “Log a new arrival” on the Receiving page." },
  { term: "Transfer", def: "Moving units from the Secondary to the Main Warehouse: requested → sent (in transit) → received." },
  { term: "Transfer required", def: "A SKU whose available units in Main are below half of its bin capacity, and Secondary has stock to send." },
  { term: "Variant", def: "The colour/size/model of a product, e.g. Blue / M." },
  { term: "Weight check", def: "The scale weight is compared with the expected weight (±25%). A big difference asks the packer to check the box." },
  { term: "Wrong lane", def: "A parcel in another courier’s lane — that driver could take it by mistake. The system asks for an extra tick and flags it in red." },
  { term: "Wrong variant / wrong SKU", def: "A scanned item that isn’t what the order needs. Rejected and recorded as an issue — caught before shipping." },
];

const STATUSES: { status: string; label: string; meaning: string; next: string }[] = [
  { status: "RECEIVED", label: "Received", meaning: "Arrived from a channel. Nothing checked or reserved yet.", next: "Office processes it on the Processing desk." },
  { status: "ON_HOLD", label: "On hold", meaning: "A processing check failed.", next: "Office reviews, then releases the hold or cancels." },
  { status: "AWAITING_STOCK", label: "Waiting for stock", meaning: "Processed, but Main doesn’t have enough available.", next: "Transfer from Secondary or put away a delivery — it continues automatically." },
  { status: "READY_TO_PICK", label: "Ready to pick", meaning: "Stock reserved. Waiting for a picker.", next: "Warehouse picks it." },
  { status: "PICKING", label: "Picking", meaning: "A picker is collecting the items.", next: "Finish picking every line." },
  { status: "READY_TO_PACK", label: "Ready to pack", meaning: "All items collected.", next: "Scan every item, box it, check weight and label." },
  { status: "PACKED", label: "Packed", meaning: "Box closed and verified.", next: "Stage it in the courier’s lane." },
  { status: "STAGED", label: "Staged", meaning: "Waiting in a known staging area for the courier (Ready to hand over page).", next: "Handed over when the courier arrives — by hand or automatically." },
  { status: "SHIPPED", label: "Shipped", meaning: "The courier took it (on a manifest). Listed on the Shipped page.", next: "Nothing." },
  { status: "CANCELLED", label: "Cancelled", meaning: "Stopped. Reserved stock released.", next: "If items were picked: return them to the shelf." },
];

const FAQ: { q: string; a: string; href?: string; link?: string }[] = [
  { q: "An order is stuck on “Waiting for stock”.", a: "Open it — “Why is this blocked?” names the SKU and numbers. Press the Next action button (usually Transfer). When the transfer is received at Main the order moves to Ready to pick by itself.", href: "/orders?stage=processed", link: "Orders" },
  { q: "The Inventory page says “Transfer required”.", a: "The bin is below half. Press Transfer (or Create all transfers). Mark it sent when it leaves Secondary and received when it is on the Main shelf.", href: "/inventory?view=replenish", link: "Below-half list" },
  { q: "I can’t find an item while picking.", a: "Press “Can’t find it”. Don’t change anything else. The office will recount, substitute or cancel from the issue.", href: "/picking", link: "Picking" },
  { q: "The scanner shows a red “Stop” message.", a: "You scanned the wrong product, the wrong size/colour, or one too many. Put that unit aside and scan the right one. Nothing is packed wrongly.", href: "/packing", link: "Packing" },
  { q: "An order is On hold.", a: "Read the reason (address, duplicate or unusual value). Call the customer or check the channel, then Release hold with a note — or cancel.", href: "/processing", link: "Processing desk" },
  { q: "The courier is at the dock.", a: "Ready to hand over → press Courier arrived on that courier’s card. Manual: collect the ticked parcels area by area, then Hand over. Automatic: confirm once — every ready parcel goes. Print the manifest for the driver to sign.", href: "/handover", link: "Ready to hand over" },
  { q: "Where is a parcel right now?", a: "Type the package, order or label in Find a package on the Staging page. It says the exact area, or which courier and manifest took it.", href: "/staging", link: "Staging" },
  { q: "A parcel must not go out yet.", a: "Move it to Rack B-04 (the hold rack). It is never handed over from there, even automatically. Move it back to its lane when it is cleared.", href: "/staging", link: "Staging" },
  { q: "A lane is full.", a: "The suggestion switches to Dispatch Zone 1 or 2 automatically. Parcels there are handed over like from the lane.", href: "/staging", link: "Staging" },
  { q: "Which parcels left today, and how?", a: "Shipped → Today. Each parcel shows its courier, time, manifest and whether it went by hand or automatically. Courier visits shows what was left behind.", href: "/shipped", link: "Shipped" },
  { q: "A parcel missed its courier pickup.", a: "An issue is opened and the parcel is moved to the next pickup automatically. Confirm with the courier and hand it over then — the issue closes itself.", href: "/handover", link: "Ready to hand over" },
  { q: "A delivery arrived.", a: "Receiving → open it (it is under “To count”) → enter what arrived and what is damaged → Confirm. Tick “put away now” if you are shelving it straight away. Waiting orders for those SKUs are reserved automatically and the reorder is updated.", href: "/receiving?tab=count", link: "Receiving" },
  { q: "Part of a delivery didn’t come.", a: "While counting, enter what actually arrived. Choose “Still coming” if the supplier will send the rest (a follow-up delivery appears with the date you give) or “Not coming” to close it — that logs an issue for the office.", href: "/receiving", link: "Receiving" },
  { q: "Stock arrived that nobody expected.", a: "Receiving → Log a new arrival. Enter who brought it, the SKUs, how many arrived and how many are damaged. If the SKU is on an expected delivery, count it there instead so the reorder is updated.", href: "/receiving", link: "Receiving" },
  { q: "I counted a delivery wrong.", a: "Press Correct on that line, enter the right numbers and why. Stock waiting for put-away is fixed automatically. If it is already on the shelf, count the bin and use Inventory → Adjust.", href: "/receiving?tab=all", link: "Receiving" },
  { q: "A SKU says “Reorder”.", a: "Neither warehouse has enough. Open Reorders — it is in “Needs reordering” with a suggested quantity and supplier. Tick it and press Order.", href: "/reorders", link: "Reorders" },
  { q: "A supplier delivery is late.", a: "Reorders shows it in red. If the supplier gives a new date, press “Change date”. If it is never coming, Cancel (nothing arrived) or Close (part arrived).", href: "/reorders?status=overdue", link: "Late reorders" },
  { q: "A button is grey (disabled).", a: "Either the step isn’t allowed yet (e.g. packing before picking) or it is an office-only action. Hover to see why; switch role in the sidebar for the demo." },
  { q: "The numbers look out of date.", a: "Pages refresh by themselves every 20–45 seconds and after every action. Press Refresh on the Dashboard to update immediately." },
];


export default function GuidePage() {
  const { meta } = useMeta();
  const [q, setQ] = useState("");
  const t = meta?.thresholds || {};
  const ql = q.trim().toLowerCase();
  const terms = useMemo(() => [...GLOSSARY].sort((x, y) => x.term.localeCompare(y.term)).filter((g) => !ql || g.term.toLowerCase().includes(ql) || g.def.toLowerCase().includes(ql)), [ql]);
  const pages = useMemo(
    () => PAGES.filter((p) => !ql || [p.title, p.what, p.who, ...p.steps, ...p.buttons.flat(), ...(p.can || []), p.tip || ""].join(" ").toLowerCase().includes(ql)),
    [ql],
  );

  const [activeId, setActiveId] = useState<string>("start");
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-guide-section]"));
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-90px 0px -60% 0px", threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [ql]);

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 50);
  }, []);

  const rules: { title: string; body: string }[] = [
    { title: "Queue order", body: "Priority orders first, then the earliest ship-by, then first received (first in, first out). Used for processing and for picking." },
    {
      title: "Ship-by",
      body: `Priority orders received before ${t.priority_cutoff || "14:00"} ship the same day by ${t.ship_by_time || "18:00"}; later ones the next day. Normal orders received before ${t.normal_cutoff || "16:00"} ship the next day; later ones the day after.`,
    },
    {
      title: "Risk",
      body: `Delayed = ship-by has passed. At risk = less than ${(t.at_risk_priority_min || 180) / 60} h left for priority (${(t.at_risk_normal_min || 360) / 60} h for normal) and not yet staged, or a priority order that is blocked.`,
    },
    { title: "Reservation", body: "Processing reserves stock in Main for the whole order or not at all. Picking turns the reservation into a real deduction exactly once. Cancelling releases it." },
    { title: "Who gets new stock", body: "When stock arrives (transfer received, delivery put away, stock found) waiting orders get it in order: priority first, then earliest ship-by." },
    {
      title: "Preventive refill (Transfer required)",
      body: `When available units in a Main bin fall below ${t.replenish_below_pct ?? 50}% of the bin capacity, a transfer from Secondary is required. Below ${t.replenish_critical_pct ?? 25}% it is critical. The suggested amount fills the bin back up (and covers any waiting orders), limited to what Secondary has.`,
    },
    {
      title: "Reorder point (buy more)",
      body: `Stock position = available in Main + available in Secondary + waiting for put-away + already on order. When it falls below ${t.replenish_below_pct ?? 50}% of the Main bin plus what waiting orders need, the SKU needs reordering. The suggestion refills the Main bin and covers those orders, rounded up to packs of ${t.reorder_round_to ?? 5}.`,
    },
    {
      title: "Receiving",
      body: "Every line is counted as arrived OK, damaged or not arrived. Missing units are either still coming (a follow-up delivery is created) or not coming (closed + issue). Only OK units wait for put-away; stock becomes sellable when it is on a shelf. Correcting a count adjusts put-away stock automatically.",
    },
    {
      title: "Holds at processing",
      body: `An order is held if the same marketplace reference was already imported, the address is incomplete (6-digit PIN, phone, street), the value is above ₹${(t.high_value_threshold || 25000).toLocaleString("en-IN")} or a line has more than ${t.max_qty_per_line || 8} units.`,
    },
    {
      title: "Where a parcel is staged",
      body: "Blocked order or cancelled → hold rack (Rack B-04). Priority → Priority Shelf P-01. Otherwise the courier’s own lane; if that lane is full → Dispatch Zone 1, then 2. Another courier’s lane needs an extra confirmation.",
    },
    {
      title: "Handing over",
      body: "Only staged parcels, not on the hold rack and without a blocking issue can leave. Manual: tick and confirm. Automatic on arrival: Courier arrived sends every ready parcel. Automatic at pickup time: at the pickup time the system sends every parcel that was ready before it. Every handover creates a manifest and a courier visit.",
    },
    { title: "Allowed steps", body: "No status dropdowns. You can’t pack before every item is picked and scanned, stage before packing, hand over before staging, or ship with an open blocking issue." },
    { title: "Packing checks", body: `Every unit scanned; wrong product, wrong variant and over-scans rejected. Label must match the order. Weight must be within ±${t.weight_tolerance_pct ?? 25}% or the packer confirms.` },
    { title: "Missed pickup", body: `A parcel still here ${t.missed_pickup_grace_min ?? 15} min after its courier’s pickup gets a Missed Pickup issue and moves to the next pickup (couriers on “automatic at pickup time” take ready parcels instead). Pickup alert ${t.pickup_alert_min ?? 60} min before if parcels aren’t staged.` },
    { title: "Nothing happens twice", body: "Tapping Picked twice, receiving a transfer twice or reporting the same problem twice never doubles stock movements or issues." },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LuBookOpen}
        title="Guide & glossary"
        subtitle="How Fulfillment Hub works, in simple words: every page, every rule and every word you will see."
      />

      <div className="grid gap-8 xl:grid-cols-[250px_minmax(0,1fr)]">
      {/* ---- contents: a sticky side list on wide screens, one scrolling row on small ones */}
      <aside className="xl:sticky xl:top-[88px] xl:self-start">
        <div className="card p-3 xl:p-4">
          <SearchInput value={q} onChange={setQ} placeholder="Search the guide…" className="w-full" />
          <p className="mb-2 mt-4 hidden px-2 text-[11px] font-bold uppercase tracking-wider text-ink-faint xl:block">On this page</p>
          <nav aria-label="Guide contents" className="-mx-1 mt-3 flex gap-1 overflow-x-auto px-1 pb-1 xl:mt-0 xl:flex-col xl:overflow-visible xl:pb-0">
            {SECTIONS.map((sec, i) => (
              <a
                key={sec.id}
                href={`#${sec.id}`}
                aria-current={activeId === sec.id ? "location" : undefined}
                className={cx(
                  "flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                  activeId === sec.id ? "bg-brand-50 text-brand-800" : "text-ink-soft hover:bg-slate-100 hover:text-ink",
                )}
              >
                <span
                  className={cx(
                    "hidden h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold xl:flex",
                    activeId === sec.id ? "bg-brand-600 text-white" : "bg-slate-100 text-ink-muted",
                  )}
                >
                  {i + 1}
                </span>
                {sec.label}
              </a>
            ))}
          </nav>
        </div>
      </aside>

      <div className="min-w-0 space-y-12">

      {!ql && (
        <>
          <Section id="start" icon={LuUsers} title="Start here">
            <div className="grid gap-4 md:grid-cols-2">
              <RoleCard
                title="Office Operator"
                steps={[
                  ["Open the Dashboard and read the Action Queue from the top.", "/"],
                  ["Process new orders on the Processing desk — they are already in the right order.", "/processing"],
                  ["Fix what is blocked: transfers, holds, stock problems.", "/inventory"],
                  ["Keep Main bins above half: create the suggested transfers.", "/inventory?view=replenish"],
                  ["Resolve issues and write the shift handover note.", "/issues"],
                ]}
              />
              <RoleCard
                title="Warehouse Worker"
                steps={[
                  ["Receiving: count deliveries and put them away.", "/receiving"],
                  ["Picking: take the top order, walk the bins in order, tap Picked.", "/picking"],
                  ["Packing: scan every item, box it, weigh it, scan the label.", "/packing"],
                  ["Staging: press “Stage at …” to put each box in its area.", "/staging"],
                  ["Ready to hand over: courier here? Press Courier arrived.", "/handover"],
                  ["Something wrong? Report it on Issues — never fix stock silently.", "/issues"],
                ]}
              />
            </div>
          </Section>

          <Section id="journey" icon={LuWorkflow} title="The journey of an order">
            <p className="mb-5 text-sm text-ink-soft">Every order moves through the same seven stages, left to right, in this exact order. Follow the line:</p>

            {/* main flow — a single connected line so the sequence reads at a glance, on every screen size */}
            <ol className="relative grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-4 lg:flex lg:gap-0">
              {JOURNEY_STEPS.map(({ icon: Icon, title: t2, desc: d }, i, arr) => (
                <li key={t2} className="relative flex flex-col items-center text-center lg:flex-1 lg:px-1.5">
                  {/* connecting line: runs behind the icon circle to the next step (desktop), or down to the next row (mobile) */}
                  {i < arr.length - 1 && (
                    <span aria-hidden className="absolute left-1/2 top-6 hidden h-0.5 w-full -translate-y-1/2 bg-brand-100 lg:block" style={{ left: "calc(50% + 24px)", width: "calc(100% - 48px)" }} />
                  )}
                  <span className="relative z-[1] flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-brand-100 bg-white text-brand-700 shadow-card">
                    <Icon className="h-5 w-5" />
                    <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white ring-2 ring-white">{i + 1}</span>
                  </span>
                  <p className="mt-2.5 text-sm font-semibold leading-tight text-ink">{t2}</p>
                  <p className="mt-1 text-xs leading-snug text-ink-muted">{d}</p>
                  {i < arr.length - 1 && <LuChevronRight className="mt-2 h-4 w-4 text-ink-faint sm:hidden" />}
                </li>
              ))}
            </ol>

            {/* side roads — shown as branches off the happy path, not buried in a sentence */}
            <div className="mt-8">
              <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                <LuGitBranch className="h-3.5 w-3.5" /> Side roads — things that can happen instead
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {JOURNEY_SIDE_ROADS.map(({ label, desc, color }) => (
                  <div key={label} className={cx("rounded-xl border p-3", color === "amber" ? "border-amber-200 bg-amber-50" : color === "sky" ? "border-sky-200 bg-sky-50" : "border-red-200 bg-red-50")}>
                    <p className={cx("text-sm font-semibold", color === "amber" ? "text-amber-800" : color === "sky" ? "text-sky-800" : "text-red-700")}>{label}</p>
                    <p className="mt-1 text-xs text-ink-soft">{desc}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-ink-muted">The order page always says exactly why it stopped and what to do next.</p>
            </div>
          </Section>
        </>
      )}

      <Section id="pages" icon={LuFileText} title="Every page, in simple words">
        {pages.length === 0 ? (
          <p className="text-sm text-ink-muted">No page matches “{q}”.</p>
        ) : (
          <>
            {!ql && (
              <nav aria-label="Pages" className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                {PAGES.map((p) => (
                  <a
                    key={p.id}
                    href={`#${p.id}`}
                    className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-[13px] font-medium text-ink-soft shadow-card transition-colors hover:border-brand-300 hover:text-brand-800"
                  >
                    <p.icon className="h-4 w-4 shrink-0 text-brand-600" /> <span className="truncate">{p.title}</span>
                  </a>
                ))}
              </nav>
            )}
            <div className="space-y-4">
              {pages.map((p) => (
                <article key={p.id} id={p.id} className="card scroll-mt-24 overflow-hidden">
                  <div className="flex items-start gap-4 border-b border-line bg-slate-50/60 px-5 py-4 sm:px-6">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-700">
                      <p.icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold text-ink">{p.title}</h3>
                      <p className="mt-0.5 text-sm text-ink-soft">{p.what}</p>
                      <p className="mt-1 text-xs text-ink-muted">
                        <span className="font-semibold">Used by:</span> {p.who}
                      </p>
                    </div>
                    <Link href={p.href} className="btn btn-secondary shrink-0 px-3 py-1.5 text-xs">
                      Open <LuArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                  <div className="grid gap-6 px-5 py-5 sm:px-6 lg:grid-cols-2">
                  <div>
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                    <LuListChecks className="h-3.5 w-3.5" /> How to use it
                  </p>
                  <ol className="mt-2 space-y-2">
                    {p.steps.map((st, i) => (
                      <li key={st} className="flex gap-2 text-sm text-ink-soft">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">{i + 1}</span>
                        <span>{st}</span>
                      </li>
                    ))}
                  </ol>
                  {p.can && (
                    <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ink-soft marker:text-ink-faint">
                      {p.can.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  )}
                  </div>
                  <div>
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                    <LuMousePointerClick className="h-3.5 w-3.5" /> Buttons and what they do
                  </p>
                  <dl className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line">
                    {p.buttons.map(([b, m]) => (
                      <div key={b} className="grid gap-1 bg-white px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3">
                        <dt>
                          <span className="inline-block rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-ink shadow-sm">{b}</span>
                        </dt>
                        <dd className="text-ink-soft">{m}</dd>
                      </div>
                    ))}
                  </dl>
                  {p.tip && (
                    <p className="mt-3 rounded-lg border border-brand-100 bg-brand-50/70 px-3 py-2 text-[13px] text-brand-900">
                      <span className="font-semibold">Tip:</span> {p.tip}
                    </p>
                  )}
                  </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </Section>

      {!ql && (
        <>
          <Section id="rules" icon={LuSlidersHorizontal} title="The rules the system follows">
            <p className="mb-3 text-sm text-ink-muted">Every decision the system makes is one of these plain rules — no hidden scoring, no guessing. Numbers come from the live settings.</p>
            <dl className="grid gap-3 md:grid-cols-2">
              {rules.map((r) => (
                <div key={r.title} className="rounded-xl border border-slate-200 bg-white p-3">
                  <dt className="text-sm font-semibold text-ink">{r.title}</dt>
                  <dd className="mt-1 text-sm text-ink-soft">{r.body}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="colours" icon={LuPalette} title="Colours & badges">
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <Legend items={[
                [<RiskBadge key="a" risk={{ state: "on_track", label: "On track", minutes_left: 300, reason: null }} />, "Will make ship-by at the current pace."],
                [<RiskBadge key="b" risk={{ state: "at_risk", label: "At risk", minutes_left: 60, reason: null }} />, "Close to ship-by — act soon."],
                [<RiskBadge key="c" risk={{ state: "delayed", label: "Delayed", minutes_left: -30, reason: null }} />, "Ship-by already passed."],
                [<PriorityBadge key="d" priority />, "Priority order — always first."],
                [<BlockedChip key="e" label="Waiting for stock" />, "Can’t move on until something is fixed."],
              ]} />
              <Legend items={[
                [<span key="f" className="chip bg-emerald-50 text-emerald-700 ring-emerald-200">OK</span>, "Green = fine / done."],
                [<span key="g" className="chip bg-amber-50 text-amber-800 ring-amber-200">Below half</span>, "Amber = needs attention soon (e.g. bin below 50%)."],
                [<span key="h" className="chip bg-red-50 text-red-700 ring-red-200">Critical</span>, "Red = act now (e.g. bin below 25%, delayed order)."],
                [<SeverityBadge key="i" severity="High" />, "Issue severity: Low, Medium, High, Critical."],
                [<span key="j" className="chip bg-sky-50 text-sky-800 ring-sky-200">In transit</span>, "Blue = in progress."],
              ]} />
              <Legend items={[
                [<span key="k" className="chip bg-brand-50 text-brand-800 ring-brand-200">Courier lane</span>, "One courier’s parcels only."],
                [<span key="l" className="chip bg-orange-50 text-orange-800 ring-orange-200">Priority shelf</span>, "Priority parcels, any courier."],
                [<span key="m" className="chip bg-sky-50 text-sky-800 ring-sky-200">Overflow · any courier</span>, "Dispatch zones, used when a lane is full."],
                [<span key="n" className="chip bg-red-50 text-red-700 ring-red-200">Hold rack · not going out</span>, "Never handed over from here."],
              ]} />
              <Legend items={[
                [<span key="o" className="chip bg-slate-100 text-ink-soft ring-slate-200">By hand</span>, "A person ticked the parcels the courier took."],
                [<span key="p" className="chip bg-violet-50 text-violet-800 ring-violet-200">Auto · on arrival</span>, "Handed over automatically when the courier arrived."],
                [<span key="q" className="chip bg-sky-50 text-sky-800 ring-sky-200">Auto · pickup time</span>, "Handed over automatically at the scheduled pickup."],
                [<span key="r" className="chip bg-brand-600 text-white ring-brand-600">Courier is here</span>, "The courier’s arrival was recorded in the last 45 minutes."],
              ]} />
            </div>
          </Section>

          <Section id="statuses" icon={LuCircleHelp} title="Order statuses">
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="table-head">
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">What it means</th>
                    <th className="px-4 py-2">What happens next</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {STATUSES.map((s) => (
                    <tr key={s.status}>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <StatusBadge status={s.status} label={s.label} />
                      </td>
                      <td className="px-4 py-2.5 text-ink-soft">{s.meaning}</td>
                      <td className="px-4 py-2.5 text-ink-soft">{s.next}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}

      <Section id="glossary" icon={LuBookOpen} title={`Glossary — words & keywords (${terms.length})`}>
        {terms.length === 0 ? (
          <p className="text-sm text-ink-muted">No word matches “{q}”.</p>
        ) : (
          <dl className="grid gap-x-6 gap-y-0 rounded-xl border border-slate-200 bg-white px-4 md:grid-cols-2">
            {terms.map((g) => (
              <div key={g.term} className="border-b border-line py-2.5">
                <dt className="text-sm font-semibold text-ink">{g.term}</dt>
                <dd className="text-sm text-ink-soft">{g.def}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      {!ql && (
        <>
          <Section id="faq" icon={LuCircleHelp} title="What to do when…">
            <div className="grid gap-3 md:grid-cols-2">
              {FAQ.map((f) => (
                <div key={f.q} className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-sm font-semibold text-ink">{f.q}</p>
                  <p className="mt-1 text-sm text-ink-soft">{f.a}</p>
                  {f.href && (
                    <Link href={f.href} className="link mt-2 inline-flex items-center gap-1 text-xs">
                      {f.link} <LuArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section id="not-built" icon={LuBan} title="Deliberately not built yet (and why)">
            <p className="text-sm text-ink-soft">The product focuses on seven everyday problems of a small warehouse:</p>
            <ol className="mt-2 grid list-decimal gap-x-8 gap-y-1 pl-5 text-sm text-ink-soft sm:grid-cols-2">
              <li>Can’t see order status at a glance</li>
              <li>Delays go unnoticed</li>
              <li>Priority orders get mixed in</li>
              <li>Stock in the spreadsheet can’t be found</li>
              <li>Wrong product or variant shipped</li>
              <li>Boxes misplaced / courier misses pickup</li>
              <li>Problems handled informally</li>
            </ol>
            <ul className="mt-4 space-y-3">
              {[
                ["Batch/wave picking", "with 2–3 pickers and bin-sorted pick lists, the added complexity wasn't worth it yet. It's the natural next step if picking becomes the bottleneck."],
                ["Full authentication", "demo roles show the permission model without passwords."],
                ["Predictive/AI features", "every rule (risk, ranking, courier choice, bottlenecks) is deterministic and explained on screen. Warehouse staff need to trust why the system says something."],
                ["Multi-carrier rate shopping, returns (RTO) processing, cycle-count scheduling", "valuable, but secondary to the seven problems above."],
              ].map(([k, v]) => (
                <li key={k} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                  <span className="font-semibold text-ink">{k}</span> <span className="text-ink-soft">— {v}</span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
      </div>
      </div>
    </div>
  );
}

function Section({ id, icon: Icon, title, children }: { id: string; icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <section id={id} data-guide-section className="scroll-mt-24">
      <h2 className="mb-4 flex items-center gap-3 text-xl font-bold text-ink">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-900 text-white">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function RoleCard({ title, steps }: { title: string; steps: [string, string][] }) {
  return (
    <div className="card card-pad">
      <h3 className="mb-3 text-base font-semibold text-ink">{title}</h3>
      <ol className="space-y-2">
        {steps.map(([s, href], i) => (
          <li key={s}>
            <Link href={href} className="group flex items-start gap-3 rounded-lg p-1.5 hover:bg-slate-50">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{i + 1}</span>
              <span className="flex-1 text-sm text-ink-soft group-hover:text-ink">{s}</span>
              <LuArrowRight className="mt-0.5 h-4 w-4 text-ink-faint opacity-0 group-hover:opacity-100" />
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Legend({ items }: { items: [React.ReactNode, string][] }) {
  return (
    <ul className="divide-y divide-line rounded-xl border border-slate-200 bg-white">
      {items.map(([badge, text], i) => (
        <li key={i} className={cx("flex items-center gap-3 px-3 py-2.5")}>
          <span className="w-36 shrink-0">{badge}</span>
          <span className="text-ink-soft">{text}</span>
        </li>
      ))}
    </ul>
  );
}
