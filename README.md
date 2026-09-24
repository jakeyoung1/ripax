# Ripax

Rip open any Pokémon TCG pack ever printed, with live market prices.

**Play it:** [ripax.ripax.workers.dev](https://ripax.ripax.workers.dev/)

## What this repo holds

Ripax now runs on a Cloudflare Worker, the only origin with a backend, so it is the only place where signing in works. This repo serves `index.html`, a bridge page on the old GitHub Pages address.

Browser storage is tied to one origin, so a collection saved on github.io can't be seen from the Worker. The bridge page checks for one first. If it finds a saved collection, it offers it as a download in the format the Worker's importer accepts. If not, it redirects straight away.
