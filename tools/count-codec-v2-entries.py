"""Count the deixis-codec-v2 corpus: name-bearing case entries and chunks across the four
codec-v2-*.json files. EVIDENCE's v2 entry quotes this output as a live claim."""
import glob
import io
import json


def run():
    cases = chunks = 0
    for path in sorted(glob.glob("vectors/codec-v2-*.json")):
        doc = json.load(io.open(path, encoding="utf-8"))
        for key, value in doc.items():
            if isinstance(value, list) and value and isinstance(value[0], dict) and "name" in value[0]:
                if key == "chunks":
                    chunks += len(value)
                else:
                    cases += len(value)
    print("{} cases, {} chunks".format(cases, chunks))


if __name__ == "__main__":
    run()
