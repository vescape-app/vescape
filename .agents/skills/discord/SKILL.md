---
name: discord
description: Turn the newest canonical release notes into a short Polish Discord announcement with emojis. Use when the user invokes /discord, asks for a Discord post about a release, or wants the changelog written up for the Polish community.
---

# Discord Release Post

Announce the release the Vescape community is about to get, in Polish, short enough to read on a phone.

## Source

Read the highest version in `release-notes/` (`ls release-notes` and pick the largest `X.Y.Z.md`) unless the user names a version. That file is the only source of claims — do not read the diff, do not invent features, do not promise anything it does not state.

## Shape

```
🚀 **Vescape <version>**

<one line per rider-visible change, each starting with a fitting emoji>
```

- Three to five bullets total. If the notes hold more, keep the changes riders will notice first and drop the rest.
- One line per bullet, one sentence, no sub-bullets and no section headings — the `## New` / `## Improved` / `## Fixed` split stays in the release notes.
- Prefix every wrist bullet with ⌚ so watch changes read as watch changes without a separate section.
- Emojis carry the category (⌚ zegarek, 🌧️ pogoda, 🗺️ mapa, 🔋 bateria, 💡 światła, 🛰️ GPS, 🍎 iOS, 🤖 Android, 🐛 fix). One per line, at the start, never mid-sentence.

## Voice

- Polish, casual, second person singular, the way a rider talks to riders. "Twoja deska", not "użytkownik deski".
- Keep every technical term in the form riders already type on Discord. Do not translate what nobody translates: duty, duty cycle, Refloat, VESC, BMS, firmware, footpad, tune, ride, watchface, tilt, nose/tail, GPS, BLE, log.
- Polish words only where the Polish word is the natural one: deska, bateria, prędkość, światła, pogoda, mapa, zegarek.
- Never invent a Polish equivalent for a product or firmware name, a setting name, or a metric. If a rider would search for the English term, keep the English term.
- Inflect borrowed terms naturally in the sentence ("na Refloacie", "z BMS-a") rather than forcing them into the nominative.
- No marketing filler, no "z przyjemnością ogłaszamy", no changelog jargon, no version-planning talk.

Output the message in one code block so it can be copied straight into Discord. Do not post it anywhere — the user sends it.
