# Interface language

The interface is available in Japanese and English. Japanese is the source; English is its translation.

## Switching

Press **日本語 / English** at the top right of the header to switch immediately. The choice is saved in the browser
and used the next time you open the app.

- Lines already in the console stay in the language they were printed in.
- Part names (Resistor, INV, …), SPICE, netlists and GDS file names stay in English in both languages.

## The first language

Without a saved choice, the first language depends on how the app was started or built.

| Command | First language |
|---|---|
| `npm run dev` / `npm run build` | Japanese |
| `npm run dev:en` / `npm run build:en` | English |

Both builds contain both languages, so you can always switch. To set it with an environment variable, use
`VITE_LOCALE=ja` or `VITE_LOCALE=en`.
