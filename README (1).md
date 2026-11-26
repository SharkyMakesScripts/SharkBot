# SharkBot

A Tampermonkey userscript that adds a helper panel to [Space Alpha](https://spacealpha.net/). It saves your planets' data as you browse the game and uses it to calculate credit generation and upgrade costs.

**Version 3.0.2**

## Install

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Open the Tampermonkey dashboard, click **+** (Create a new script), delete the template, and paste in the contents of `SharkBot v3.0.2.js` (the file name always carries the version).
3. Save with **Ctrl+S** (**Cmd+S** on Mac) and reload any spacealpha.net page. The panel appears at the top right.

The panel can be dragged by its header and collapsed with **−**. Drag its bottom-right corner to resize it (double-click the corner to reset), or click **⤢** to expand it to fill the screen and again to go back. Size, expanded state and UI size are remembered. Your data is stored in your browser through Tampermonkey; nothing is sent anywhere.

## Registration

SharkBot unlocks once Sharky accepts you. Until then the panel shows only a **Welcome** tab (what SharkBot does, how to start, and the **Register** box). Once you're accepted, Welcome disappears, the panel opens on General → Debug and the tour starts for first-time users; if your copy is locked again, Welcome comes back.

1. Open the game so the top bar shows your username; SharkBot reads it from there.
2. Tick **I agree to share my SharkBot data with Sharky** (required: sharing is part of registering), then click **Register**. This sends your username, your copy's install code (a random code made by each SharkBot copy) and the SharkBot version to Sharky; the date you agreed is recorded on Sharky's server.
3. Wait for Sharky to accept. SharkBot checks every 15 minutes while you're pending (or click **Check now**), then hourly.

Each browser registers separately. If the game shows a different account than the one you registered, SharkBot locks again until that account registers. If you're denied, you can register again 24 hours later. If Sharky's server can't be reached, your last status is kept. To stop sharing, **Unregister** in General → Settings → Sharing & registration (click twice to confirm): SharkBot locks again, you can register again any time, and data already sent stays with Sharky.

## Getting started

The first time the panel opens, a short interactive tour shows auto-scan working live, points out the pages that need a click from you, and ends with a checklist of pages still to visit for the open planet. You can skip it, and replay it anytime from **General → Settings → Restart tutorial**.

1. Just play. SharkBot **scans automatically** each time you open a game page: it reads the planet name from the game and saves everything to that planet's slot. Each new planet you scan is added automatically and named after the game, up to 10 planets. The Debug tab shows which planet was detected.
2. Visit these pages on each planet (they're saved as you go, and again whenever you come back):
   - **Nation:** population, growth, army, sickness, pollution, forest and planet defense
   - **Train Units:** unit counts
   - **Facilities:** use the old view. Pick **Resources**, **Military** or **Areas** (not **New view**). If switching views doesn't change the page address, click **Scan** after each switch. Saving one view keeps the others: each scan updates the facilities and areas it shows and keeps every other saved one (since v2.25.1).
   - **Research:** shared by all planets. Each scan adds or updates the research it sees and keeps the rest, so if the Research page splits research into groups, scan each group once. Your **brains**, **diamonds** and **SSB** counts are saved from this page too
   - **Bank:** scan both tabs. Your own bank tab saves **your bank balance**; the **TRAPs** tab saves your investments (switching to it doesn't change the page address, so click **Scan** there); the **Central bank** tab saves the **galaxy fee** and the Central bank's stats. They're stored separately
   - **Market:** current prices
   - **Cards → All Hero cards:** your card collection (shared by all planets)
3. Every page also saves the planet's inventory (the Planet Inventory box at the top) Colony status (productivity, happiness, sickness) is saved the moment it appears: hover the colony face in the top bar on each planet, and open the **Colony Status** window (click the face) once so the **work mode** is saved too.

Click **Scan** to rescan the current page anytime. Auto-scan can be turned off in **General → Settings**. The Save buttons in each tab do the same as Scan. If the other planet is open in the game, they refuse, so data never lands in the wrong slot.

## Tabs

The main tabs are General, Data, Calculators and Statements, plus **Welcome** while your copy isn't registered yet. Each remembers which subtab you last opened. **Every table with column titles can be sorted:** click a title to sort by it, click again to reverse (▲ / ▼ shows which). Numbers and dates sort largest/newest first on the first click, words A→Z; empty cells stay at the end, and totals stay at the bottom. Each table remembers its sort (Reset all saved data keeps it).

**General**

| Subtab | What it shows |
|---|---|
| Debug | Status, detected planet, a summary of the last scan, and the raw scan data (with a Copy button) |
| Settings | **Planets** (rename or remove), **Window & UI size** (UI size slider 70–150% in 5% steps with 90/100/110/125% buttons, which scales text, tables and pop-ups; the current window size; **Reset size & scale**), **auto-scan** on/off, **Sharing & registration** (last send, **Send now**, **Unregister**), **Restart tutorial**, color schemes (Navy by default, plus Crimson, Ember, Amber, Tangerine, Sunset, Emerald, Graphite, and a **Custom** scheme with your own colors under **Customize colors**) and **Reset all saved data**, which keeps your registration, color scheme and panel layout |

**Data** (top row **Empire**: shared by all planets; bottom row **Planet**: saved per planet)

| Subtab | What it shows |
|---|---|
| Units | Unit counts and Barracks level for each planet. **Compare with** adds a column showing the difference from another planet |
| Research | Research levels (shared by all planets) and what each level does, plus your brains, diamonds and SSB |
| Facilities | Facility levels and output, plus Areas and how full they are, for each planet (with the same **Compare with** option) |
| Market | Buy and sell prices for every resource, and the spread between them |
| Inventory | Stored resources on every planet side by side, a total, and your bank balance |
| Bank | **⧉ Open everything in a new window** shows all of this full-width. Three sections: **Your bank** (your balance and the other lines on that tab), **Central bank** (galaxy fee and the Central bank's stats) and **Investments**: all TRAPs in one table (your amount and share, total, 24h/7d/30d change, price, interest per turn, daily interest for the whole TRAP and for you; **Only mine** shows the investments you hold plus every managed investment (even with no amount typed yet, so you can fill it in), here and in the pop-out; a **Managed** tick box per investment: managed ones use **only** the amount you type in (blank counts as 0; your TRAPs share value shows underneath in grey for reference) and earn interest × your share; unmanaged ones use your share value from the TRAPs page and earn the share price change (volatility × equity change), taken as your value × the 24h change; names or descriptions saying "managed" start ticked), every investment from the game's public list (`/openapi/investments`) joined with your TRAPs scan, showing your amount, your share of the total, interest per turn, daily interest for the whole investment and for your portion, and your total daily interest. The list refreshes every 10 minutes (or **↻ Refresh API**); **Turns per day** (default 1,440) sets how many interest turns make a day. Only your own balance counts toward capital |
| Cards | Two compact dropdown lists: **by effect** (best value, how many days that card lasts, and total days across all your cards with the effect; open it to see each card) and **by card type** (card count and total days; open it to see each card's effects). Only one card can be active at a time, and a card's days are how long it lasts once used |
| Nation | Productivity, happiness (and max), sickness, wealth, work mode, population, growth, army size, sickness, pollution, temperature, forest, reward chest and planet defense, side by side for every planet |

**Calculators**, ranked by complexity in three tiers (Tier I takes two rows):
- **I** (one formula): Turn Storage, Area Size, Turn Gen, Training, Research, Energy, Productivity
- **II** (models built from many saved values): Credit Gen, Resource Gen, Unit Value
- **III** (optimizers that combine the others): Best Spend, Value Optimizer

| Subtab | What it shows |
|---|---|
| Credit Gen | Productivity is multiplied by your best **productivity Hero card** (tick box; untick if the game's productivity already includes it). Credit income split into **passive** (per tick and per day, with work mode) and **printing** (per turn, per print day, average per day and per week; no work mode, after galaxy fee), plus combined daily and weekly totals and a per-worker breakdown. Daily assumptions are editable: ticks per day (1,440), turns per print day (100,000 over 2 prints) and print days per week (5). All other inputs fill in from saved data |
| Resource Gen | Coal, iron and gold made per turn and per day, and their value in credits at market sell (or buy) prices. Fills in productivity, mine workers and slaves, iron and gold mine levels, Digging/Iron mining/Gold mining research and turns per day (from the Tick Generator) from saved data; card bonuses come from your most profitable saved Hero card (only one can be active), or type your own. A **Compare** column shows what a change would add |
| Productivity | Sickness per tick for a planet: **healed** = doctors × (1 + Medicine/2) × sick share + √happiness/100 × worker ratio × sick + work-mode happiness/10 × worker ratio × sick; **added** = pollution^1.2/happiness² × (1 − sick share) + 500 × sick/happiness² × (1 − sick share^0.35) × (1 − reduce-sickness card). Shows the net change, where sickness will be after a day, and the level it settles at. Fills from Units, Medicine, Nation, colony status and cards; worker ratio defaults to workers ÷ population and work-mode happiness is typed |
| Unit Value | **Untrained** per tick = (√(farmers ÷ 3) + 10) × (0.3 × Food Factories^1.18 + 100)/100 × (1 + best untrained card) × productivity. **Slaves** and **Professors** each split into **passive** (every planet trains one turn's worth per tick for free, × ticks per day) and **turn spend** (slaves per turn = 50% of untrained per tick; professors per turn from the Training formula with the best card; × the planet's turns per day), valued at the market sell and buy prices (plus your own price if typed), per day and per turn, shown as tables. Slave values count only your **split** (% of the sale you keep; default 80%, i.e. the 20% Gastro tax); professors are valued at full price. Optional **daily sell limits** (blank = no limit) cap what's sold, passive first, and show how many turns reach the limit. Professors are net of the untrained used and compared with your Value Optimizer turn. With several planets, an **All planets** block lists each planet's passive slaves and professors per day, the total and its worth |
| Area Size | What it costs to grow an Area, by target level or target area size: credit cost (with the best saved card that lowers area upgrade cost, and how long it lasts), starting and ending area size, and the gain, against the credits you hold. Starting level fills in from Facilities → Areas; only Industrial Area, Commercial Area and Farms use a research level (Industrialism, Commercialism, Farmialism), filled in automatically |
| Turn Gen | Tick Generator upgrade cost by target level or target turns per minute (TPM), compared with what you have, and converted to credits at market prices |
| Best Spend | Splits **all your capital** between Area upgrades, the Tick Generator and **income research** (Economy, Industrialism, Commercialism, Digging, Iron and Gold mining; costs as in the Research calculator, gains added up over all planets), a slice at a time, wherever the next slice adds the most credits per day. Shown as tables: your capital, then each upgrade's levels, spend, what it adds, training turns, credits per day gained and payback, with a total row. Also sets the credit value of brains, diamonds and SSB |
| Value Optimizer | Checks **every planet for every method** (printing credits, making resources at market price, and training and selling **slaves** (your kept share) or **professors** (net of untrained) from Unit Value, within the daily sell limits left after passive training; a **Sell limits** section shows each limit, what passive training fills, and the most turns worth spending on selling) and ranks them by credits per turn. Your turns are pooled and handed to the best method first, so the plan can be e.g. printing on B and resources on A. Printing shares one daily cap (Credit Gen's turns per print day); turns past it go to the best resource planet. Shows the plan for print days and non-print days, the weekly total, and how it compares with only printing or only resources. Turns per day = all planets' Tick Generators, or type your own |
| Training | Units trained in one turn for every unit type, broken down as **base** (Barracks, plus professors/tacticians/teachers where they count), **+ research** (Education, and Tactics for Majors and Champions), **+ card** and the **total**, using Barracks level, Education and Tactics research, professors/tacticians/teachers, and the **best saved Hero card for each unit row** (training-speed cards only; no card choice needed). Also the Barracks upgrade cost (credits after the best barracks cost card, iron, gold). Fills in from saved data: Barracks level from **Train Units**, research, units and cards |
| Turn Storage | Most turns you can hold: Turn Storage level × 10 + Brains × 100 + 200, and how many hours your Tick Generator takes to fill it. Level from Facilities on whichever planet has it: any saved facility whose name has both "turn" and "stor" (e.g. Turn Storage, Turns Storage Facility). If none matches, a **Which facility is Turn Storage?** list shows every saved facility; pick it once and it's remembered. The result says where the level came from (facility, planet, scan date). Brains from Research. Both editable; clear a box to go back to the saved value |
| Research | A table of the next level of every research with **every cost in credits**: credits, iron, gold and tritium (market buy price), energy (when a level needs more than the planet stores, the cost of the extra SSB storage at market buy price, marked ⚡) and the turns it takes (× the average turn value from Value Optimizer), plus the total, cheapest first. Hover a cell for the raw amount. Research without a known formula (or not yet scanned) shows ???. Uses your scientists (pick the planet), Computer Technology, brain boost (read from the Research page: costs ×0.75, research points ×2) and your best research-speed and research-requirement cards. Tick boxes turn brain boost and each card on or off |
| Energy | Energy storage for a planet: Solar Power (3,000 × level × (1 + 5% × Solar power research)), Coal Power (3,000 × level), Wind Power (5,000 × level), Tritium Power (100,000 × level), Tritium Accumulator (10,000 × level) and SSB (× 100), multiplied by Energy Core (1 + level^1.2 ÷ 5 %), Energy Technology (+1% per level) and your best energy card. Levels fill in from Facilities, research and SSB (editable). The Research calculator flags (⚠) research that needs more energy than the planet can store |

Every calculator ends with an **All capital here** block: what spending all your capital in that calculator would buy (Credit Gen: Industrial/Commercial Area levels; Resource Gen: mine-worker area levels; Turn Gen: Tick Generator levels; Area Size: levels of the selected area), with the credits per day it adds. The bar at the top of every calculator is shared by all of them:
- **Capital to use:** a slider in 5% steps, or click **25%**, **50%**, **75%** or **100%**. Plans only spend that share of your capital (the cost checks in Turn Gen and Area Size still compare against all of it).
- **Set amount:** type an exact budget instead, e.g. `15 Sx`, `5b gold`, `3 billion coal` or `2 T iron + 1.5 Sx`. Resources are valued at the market sell price; brains, diamonds and SSB at their Best Spend value; a number with no name is credits. It overrides the percentage (clicking a % button clears it). An amount bigger than your capital gives a what-if plan.
- **Brains**, **Diamonds**, **SSB:** separate tick boxes for which of them count as capital.

**Statements** (built from everything saved; a snapshot is kept at most once an hour as you play)

| Subtab | What it shows |
|---|---|
| Balance | A standard balance sheet, all planets summed: **Assets** (current: cash on planets, bank deposits, inventory at market; non-current: TRAPs, brains/diamonds/SSB) and **Liabilities and stockholders' equity** (current and long-term debt from the Debt switch, opening capital, retained earnings), with today next to a snapshot at least a day old. Two switches at the top: **Balance Sheet** and **Debt** (it remembers the last one). **Debt:** what you owe, in **credits or resources** (gold, iron, coal, diamonds, brains, SSB, any market resource, or a mixed typed amount). Each debt: lender, currency, interest % per day, start date, **transferred**, **interest so far**, **paid back** and the **update date** those amounts are correct for, plus an optional due date (dates are picked from a popup calendar with Today, and Clear on the due date) and Current / Long-term (Auto = current if due within 7 days or no due date). Current = transferred + interest; owed now = current − paid, compounded daily from the update date to today; **Roll to today** adds that interest into "interest so far". Resources are valued at a price you type (e.g. 8.5e13) or the market buy price. Shows totals **by currency** (owed, interest per day, in its own units and in credits, plus all in credits), each debt, current vs long-term, debt ÷ assets, equity after debt and how long net income takes to pay it off. Debts feed the Balance Sheet liabilities, debt interest on the Income and Cash Flow statements, and equity on the Stockholder statement |
| Income | Income statement per day and week: passive credits (Credit Gen), turn spending as **Value Optimizer** plans it (printing, resources and unit sales by planet, print and non-print days averaged), and TRAP interest, minus the galaxy fee and debt interest |
| Cash Flow | Expected cash per day (passive + printing after fee), non-cash income (resources, interest), and the actual change between the last two snapshots |
| Stockholder | Opening equity + estimated net income vs. actual equity now (the gap is what you spent), plus the equity history |

Each statement has a button to open all of them in a new window.

**Sharing** is part of registration: there's no separate setting. Once you're accepted, SharkBot sends your player name and saved data to Sharky at most every 15 minutes after a scan. General → Settings → **Sharing & registration** shows the last send, **Send now** and **Unregister**. Copies accepted before v2.23.3 show a one-time note there.

## Notes

- Turns are one empire-wide pool: the Tick Generator and Turn Storage are each on one planet (SharkBot finds whichever planet has them), and every calculator uses those turns for all planets.

- Market prices are treated as the price of a single unit when converting resources to credits.
- Cost calculators (Turn Gen, Area Size) count your **capital**: credits on every planet and in the bank, plus stored resources you could sell at the market sell price. Resources an upgrade consumes are set aside first, and anything missing is priced at the market buy price.
- Best Spend and the All capital blocks assume an area's size is how many workers it holds, and that the new room is filled by training workers. Training costs turns (Training's Soldiers & workers per turn, with your best card), valued at the Value Optimizer average turn; options are ranked by credits/day per (credits + training turn value), and payback includes it. Industrial Area → industrial workers, Commercial Area → commercial workers, an area named like "Mines" → mine workers. An extra turn is worth the Credit Gen credits per turn plus the Resource Gen credits per turn. Materials you own are valued at the sell price, missing ones at the buy price.
- Brains, diamonds and SSB each count only when their tick box is on, at the value you set in Best Spend (or the market sell price if the market lists them).
- Research effects marked "—" haven't been documented yet.
- Saved data is only as fresh as your last Scan; each tab shows when its data was saved.
- The helper holds up to 10 planets. With more, scanning an 11th tells you; remove one in **Settings → Planets** to make room.
- Wide tables (Inventory, Nation) scroll sideways when you have many planets.
- **Clear** on a slot erases its data but keeps the planet name. **Settings → Reset all saved data** erases planets, research, market, bank, debts and calculator inputs; your registration (so you stay accepted on the same device), color scheme and panel layout are kept.
- If something doesn't save, the Debug tab's Status line says why. Use **⧉ Copy** (General → Debug) to share the scan output when reporting a problem.

## Updating

Open SharkBot in the Tampermonkey dashboard, replace its code with the new version, and save. Pasting into the existing script keeps all your saved data; installing it as a separate new script starts from empty. Save with **Ctrl+S** and reload the game; the panel header should show the new version. If two copies are installed, SharkBot shows a red warning naming both versions.

## Version numbers

**public release . private change . small change**. For example, 3.0.0 is the third public release, and 3.1.2 would be the third public release plus one private change and two small changes.
