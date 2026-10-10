# Community song and alias data

Source: https://github.com/Catrong/phi-plugin

`info.csv` is a tab-separated song metadata table. `nicklist.yaml` contains community song aliases. `provenance.json` records the exact upstream commit and SHA-256 checksums. The upstream license is retained in `LICENSE`.

These are community-maintained records, not an official Phigros API. Phiguess uses a local snapshot for judging and does not send player answers or credentials to this provider. No plugin application code is imported.

Run `npm run aliases:sync` with the target database configuration to update managed aliases. Local additions belong in `data/catalog/aliases.local.json`, keyed by upstream song ID. Network or validation errors keep the previous database snapshot intact.
