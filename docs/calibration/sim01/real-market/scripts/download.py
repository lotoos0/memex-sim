"""Download only the pinned raw inputs; never install a tool or project dependency."""

import argparse
from pathlib import Path
import urllib.request

from reproduce import read_json, file_sha256, BENCHMARK


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw-dir', required=True, type=Path)
    args = parser.parse_args()
    raw = args.raw_dir.resolve()
    if raw == BENCHMARK or BENCHMARK in raw.parents:
        parser.error('raw-dir must be outside the versioned reference')
    dataset = read_json(BENCHMARK / 'sources.json')['dataset']
    for item in dataset['files']:
        target = raw / item['path']
        if target.is_file() and target.stat().st_size == item['bytes'] and file_sha256(target) == item['sha256']:
            print(f"Verified cached {item['path']}", flush=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://huggingface.co/datasets/{dataset['id']}/resolve/{dataset['revision']}/{item['path']}"
        partial = target.with_suffix(target.suffix + '.partial')
        # A failed download never replaces an existing verified input.
        with urllib.request.urlopen(url, timeout=300) as response, open(partial, 'wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        if partial.stat().st_size != item['bytes'] or file_sha256(partial) != item['sha256']:
            raise ValueError(f"Downloaded input checksum/size mismatch: {item['path']}")
        partial.replace(target)
        print(f"Verified downloaded {item['path']}", flush=True)


if __name__ == '__main__':
    main()
