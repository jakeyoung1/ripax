# Ripax

Rip open any Pokémon TCG pack ever printed, with live market prices.

**Play it:** [ripax.ripax.workers.dev](https://ripax.ripax.workers.dev/)

## What this repo holds

Ripax now runs on a Cloudflare Worker, the only origin with a backend, so it is the only place where signing in works. This repo serves `index.html`, a bridge page on the old GitHub Pages address.

Browser storage is tied to one origin, so a collection saved on github.io can't be seen from the Worker. The bridge page checks for one first. If it finds a saved collection, it offers it as a download in the format the Worker's importer accepts. If not, it redirects straight away.

## Architecture

```
ripax.ripax.workers.dev          Cloudflare Worker: the app and its backend
  /                              client, pack rules, per-set card and price data
  /auth/*                        Google sign-in
  /api/me  /api/rip              session, record a finished rip
  /api/collection  /api/import   read or clear a collection, import a local one

jakeyoung1.github.io/ripax       GitHub Pages: this repo
  index.html                     bridge: rescue a local collection, then redirect
```

Signed out, a collection lives in `localStorage`. Signed in, the Worker is the source of truth: each finished rip is posted to `/api/rip`, and if that call fails the rip is kept locally so it can be uploaded later instead of lost.

The Worker's source is not in this repo. The client, the pack rules, and the card data are in this repo's history, in the static build that ran here before the bridge page replaced it: [`e0ea6b4`](https://github.com/jakeyoung1/ripax/tree/e0ea6b46e26506fa2935bc26b61e3bca8138ad7f). The sections below describe that build.

## How a pack is opened

Every set is matched by its series to an era in `config/pack-rules.json`. There are 14 eras, from Base (1999) to Mega Evolution. Each one defines the pack layout, the odds for the rare slot, and the original retail price of each product sold in that era. A Base Set pack is 7 commons, 3 uncommons, and a rare slot. A Scarlet & Violet pack is 4 commons, 3 uncommons, a reverse holo, an energy, and a rare slot with 12 weighted rarity tiers.

- **The rare slot rolls a rarity, then a card.** Weights are renormalised over the tiers the set actually contains, so a set with no Illustration Rares redistributes that weight instead of rolling an empty tier. The odds are community-sourced estimates, because The Pokémon Company has never published pull rates.
- **Only pack cards are in the pool.** Lettered alternate prints such as `101a` came from tins and promos rather than packs, so they are excluded. Basic energy only comes from the energy slot.
- **No printing appears twice in one pack.** A card can still show up as both its normal and its reverse holo print, since those come off separate print rows.
- **The rare slot is revealed last**, so the flips build to it. Opening is one gesture per card: swipe to tear the wrapper, then drag each card off the stack, and it turns face-up as it moves.

**A booster box is not 36 independent packs.** Real boxes are collated from printed sheets, so their hit counts are close to fixed. Ripax plans a box's hits before dealing it: each rarity gets a quota of packs times odds, the whole part is guaranteed, and the fraction is settled with one coin flip for the whole box. In sets with chase tiers, 18% of boxes run one of them hot by a single card, so the occasional two-secret-rare box still happens. Commons and uncommons are dealt from shuffled sheets without replacement, so a box covers most of a set's commons.

The engine is pure functions with an injected, seedable random source (mulberry32), so any roll can be reproduced from its seed.

## How prices work

Card data and prices come from the [Pokémon TCG API](https://pokemontcg.io). The August 2026 data build covers 174 sets from 1999 to 2026, 143 of them openable, with prices for 20,386 of 20,479 cards.

- **Each card has a price per print variant:** normal, holofoil, and reverse holofoil. A pull is valued at the variant it came out as, so the reverse-holo slot pays the reverse-holo price and holo rarities pay the holofoil price. If that variant has no price, any known price is used rather than $0.
- **Every rip is scored like a purchase:** cost, value of the cards pulled, profit or loss, and the best pull. Cost is the era's original retail price, so a vintage box is priced in 1999 money rather than today's sealed market, and the readout says so.
- **The reveal celebrates value as well as rarity.** Each pull gets the higher of a rarity tier and a value tier. Rarity tiers are calibrated against each rarity's median market value across every openable set, so Gold Stars (median about $1,250) rank at the top and Hyper Rares (about $8) no longer trigger the full walkout. The value tier means a Base Set Charizard, printed as a plain Rare Holo, still gets full fanfare.

## Tech

| Layer | Technology |
|---|---|
| Client | Vanilla JavaScript (ES modules), HTML, CSS. No framework, no build step. |
| Sound | Web Audio API. Rip sounds are synthesised at runtime, with no audio files. |
| Backend | Cloudflare Worker: Google sign-in and the collection API |
| Data | Pokémon TCG API for sets, cards, and prices. Card images from images.pokemontcg.io. |
| Bridge | GitHub Pages (this repo) |
