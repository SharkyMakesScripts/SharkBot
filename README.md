# SharkBot

A Tampermonkey userscript that adds a helper panel to [Space Alpha](https://spacealpha.net/). It saves your planets' data as you browse the game and uses it to calculate credit generation and upgrade costs.

**Version 2.0.1**

## Install

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Open the Tampermonkey dashboard, click **+** (Create a new script), delete the template, and paste in the contents of `SharkBot v2.0.1.js` (the file name always carries the version).
3. Save with **Ctrl+S** (**Cmd+S** on Mac) and reload any spacealpha.net page. The panel appears at the top right.

The panel can be dragged by its header and collapsed with **−**. Your data is stored in your browser through Tampermonkey; nothing is sent anywhere.

## Getting started

The first time the panel opens, a short interactive tour shows auto-scan working live, points out the pages that need a click from you, and ends with a checklist of pages still to visit for the open planet. You can skip it, and replay it anytime from **General → Settings → Restart tutorial**.

1. Just play. SharkBot **scans automatically** each time you open a game page: it reads the planet name from the game and saves everything to that planet's slot. Each new planet you scan is added automatically and named after the game, up to 10 planets. The Debug tab shows which planet was detected.
2. Visit these pages on each planet (they're saved as you go, and again whenever you come back):
   - **Nation:** population, growth, army, sickness, pollution, forest and planet defense
   - **Train Units:** unit counts
   - **Facilities:** use the old view. Pick **Resources**, **Military** or **Areas** (not **New view**). If switching views doesn't change the page address, click **Scan** after each switch. Saving one view keeps the others.
   - **Research:** shared by all planets, so one scan covers both
   - **Bank:** open the **Central bank** tab first (bank balance and galaxy fee)
   - **Market:** current prices
   - **Cards → All Hero cards:** your card collection (shared by all planets)
3. Every page also saves the planet's inventory (the Planet Inventory box at the top) Colony status (productivity, happiness, sickness) is saved the moment it appears: hover the colony face in the top bar on each planet, and open the **Colony Status** window (click the face) once so the **work mode** is saved too.

Click **Scan** to rescan the current page anytime. Auto-scan can be turned off in **General → Settings**. The Save buttons in each tab do the same as Scan. If the other planet is open in the game, they refuse, so data never lands in the wrong slot.

## Tabs

The panel has three main tabs. Each remembers which subtab you last opened.

**General**

| Subtab | What it shows |
|---|---|
| Debug | Status, detected planet, a summary of the last scan, and the raw scan data (with a Copy button) |
| Settings | **Planets** (rename or remove), **auto-scan** on/off, **Restart tutorial**, color schemes (Navy by default, plus Crimson, Ember, Amber, Tangerine, Sunset, Emerald, Graphite, and a **Custom** scheme with your own colors under **Customize colors**) and **Reset all saved data**, which keeps your color scheme |

**Data**

| Subtab | What it shows |
|---|---|
| Units | Unit counts for each planet. **Compare with** adds a column showing the difference from another planet |
| Research | Research levels (shared by all planets) and what each level does |
| Facilities | Facility levels and output, plus Areas and how full they are, for each planet (with the same **Compare with** option) |
| Market | Buy and sell prices for every resource, and the spread between them |
| Inventory | Stored resources on every planet side by side, a total, and the bank balance |
| Bank | Everything read from the Central bank tab |
| Cards | Two compact dropdown lists: **by effect** (best value, how many days that card lasts, and total days across all your cards with the effect; open it to see each card) and **by card type** (card count and total days; open it to see each card's effects). Only one card can be active at a time, and a card's days are how long it lasts once used |
| Nation | Productivity, happiness (and max), sickness, wealth, work mode, population, growth, army size, sickness, pollution, temperature, forest, reward chest and planet defense, side by side for every planet |

**Calculators**

| Subtab | What it shows |
|---|---|
| Credit Gen | Credits per turn from your workers, facilities, research, work mode, productivity and galaxy fee. All inputs fill in from saved data |
| Turn Gen | Tick Generator upgrade cost by target level or target turns per minute (TPM), compared with what you have, and converted to credits at market prices |

## Notes

- Market prices are treated as the price of a single unit when converting resources to credits.
- Research effects marked "—" haven't been documented yet.
- Saved data is only as fresh as your last Scan; each tab shows when its data was saved.
- The helper holds up to 10 planets. With more, scanning an 11th tells you; remove one in **Settings → Planets** to make room.
- Wide tables (Inventory, Nation) scroll sideways when you have many planets.
- **Clear** on a slot erases its data but keeps the planet name. **Settings → Reset all saved data** erases everything except your color scheme.
- If something doesn't save, the Debug tab's Status line says why. Use **⧉ Copy** (General → Debug) to share the scan output when reporting a problem.

## Updating

Open SharkBot in the Tampermonkey dashboard, replace its code with the new version, and save. Pasting into the existing script keeps all your saved data; installing it as a separate new script starts from empty. Save with **Ctrl+S** and reload the game; the panel header should show the new version. If two copies are installed, SharkBot shows a red warning naming both versions.

## Version numbers

**public release . private change . small change**. For example, 2.0.1 is the second public release plus one small change.
