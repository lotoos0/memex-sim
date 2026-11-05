"""Real standard non-instant cohort restricted to launch hours 08Z and 19Z."""

import os
import sys, csv, itertools, json
from pathlib import Path
from analyze import Dataset, H
D = Path(os.environ['SIM01_WORK_DIR'])
launches = {r['mint']: r for r in csv.DictReader(open(D / 'launches.csv', newline='', encoding='utf8'))}
d = Dataset('real_standard_noninstant_hours08_19')
with open(D / 'real-standard.csv', newline='', encoding='utf8') as f:
    for mint, g in itertools.groupby(csv.DictReader(f), key=lambda x: x['mint']):
        l = launches[mint]
        hour = (int(l['launch_ts']) - 1792022400) // 3600
        if hour not in [8, 19]:
            continue
        rows = list(g)
        c = float(l['completion_age']) if l['completion_age'] else None
        m = c if c is not None and c <= H else None
        data = [(float(x['age_sec']), float(x['price_sol']), float(x['progress']), float(x['quote_sol']), x['side']) for x in rows]
        d.add(mint, data, m if m is not None else H, m, c is not None and c <= 1)
json.dump(d.result(), open(D / 'hours-sensitivity.json', 'w'), indent=2, allow_nan=False)
print('Matched-hour real analysis complete', d.active, len(d.first80))
