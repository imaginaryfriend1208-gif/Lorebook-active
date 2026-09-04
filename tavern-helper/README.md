# Lorebook Active — Tavern Helper popup script

Standalone script that shows the active World Info list in a custom centered
popup. Runs inside [Tavern Helper (JS-Slash-Runner)](https://github.com/N0VI028/JS-Slash-Runner)
and reads its data from the `/wi-triggered` slash command provided by the
**Lorebook Active** extension — both must be installed.

## Install

1. SillyTavern → Extensions → install **Tavern Helper** (JS-Slash-Runner).
2. Keep the **Lorebook Active** extension installed (it provides `/wi-triggered`).
3. Tavern Helper panel → 脚本库 (Script Library) → 全局脚本 (Global Scripts) →
   create a new script.
4. Paste the whole content of `wi-popup.js`, save, enable.

## Features

- Floating gradient 📖 button, draggable, position saved in `localStorage`
- Centered glassmorphism popup (never clipped at top on mobile; scrolls when tall)
- Entries grouped by book, color dot per strategy (constant / normal / vectorized)
- Matched-key chips: green = matched in chat, amber = matched via recursion
- Sticky counter, full tooltip with activation reason + content preview

Data refreshes on `WORLD_INFO_ACTIVATED` and `GENERATION_ENDED` events.
