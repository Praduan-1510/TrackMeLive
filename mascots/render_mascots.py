# Renders mascots to 1024px PNGs with headless Chrome.
# Serve mascots/model on port 8765 first, then:
#   python3 mascots/render_mascots.py [--parallel N] <out-dir> [job ...]
# Jobs (parsed by mascots/model/jobs.mjs):
#   fox                 -> fox.png
#   hero:dusk           -> hero-dusk.png
#   fox@glasses         -> fox-glasses-full.png  the mascot wearing the accessory, one scene (for checking)
#   star:rose@glasses   -> star-rose-glasses-full.png
#   fox@glasses/layer   -> fox-glasses.png       the accessory alone, an overlay for fox.png
#   layers              -> every supported <mascot>@<accessory>/layer (from ACCESSORY_SUPPORT)
#   combos              -> every supported <mascot>@<accessory>
# With no jobs, renders all twelve mascots. A layer costs three renders, so batches are sized by cost.
import base64
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from pathlib import Path

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
MODEL = Path(__file__).resolve().parent / "model"
BATCH = 5  # renders per Chrome run
JOB = re.compile(r"([a-z]+)(?::([a-z]+))?(?:@([a-z]+)(/layer)?)?")

args = sys.argv[1:]
parallel = 1
if args[:1] == ["--parallel"]:
    parallel, args = int(args[1]), args[2:]
OUT = Path(args[0])
OUT.mkdir(parents=True, exist_ok=True)


def support():
    # The support matrix lives in accessories.mjs; read it from there rather than copy it.
    src = (MODEL / "accessories.mjs").read_text()
    block = re.search(r"ACCESSORY_SUPPORT = \{(.*?)\n\};", src, re.S).group(1)
    return [(m, a) for m, items in re.findall(r"(\w+): \[(.*?)\]", block) for a in re.findall(r"'(\w+)'", items)]


JOBS = []
for job in args[1:] or [
    "fox", "ghost", "robot", "astronaut",
    "hero", "star", "ninja", "neko",
    "ace", "detective", "cowboy", "agent",
]:
    if job == "layers":
        JOBS += [f"{m}@{a}/layer" for m, a in support()]
    elif job == "combos":
        JOBS += [f"{m}@{a}" for m, a in support()]
    else:
        JOBS.append(job)


def file_name(job):
    name, color, acc, layer = JOB.fullmatch(job).groups()
    parts = [name]
    if color and color != "original":
        parts.append(color)
    if acc:
        parts.append(acc if layer else f"{acc}-full")
    return "-".join(parts) + ".png"


def cost(job):
    return 3 if job.endswith("/layer") else 1


batches, batch = [], []
for job in JOBS:
    if batch and sum(map(cost, batch)) + cost(job) > BATCH:
        batches.append(batch)
        batch = []
    batch.append(job)
if batch:
    batches.append(batch)


# One Chrome profile per worker, kept out of the output folder.
PROFILES = tempfile.TemporaryDirectory(prefix="mascot-chrome-")
SLOTS = Queue()
for k in range(parallel):
    SLOTS.put(Path(PROFILES.name) / f"profile-{k}")


def run(batch):
    slot = SLOTS.get()
    cmd = [
        CHROME,
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--enable-unsafe-swiftshader",
        "--use-angle=swiftshader",
        "--ignore-gpu-blocklist",
        "--virtual-time-budget=120000",
        f"--user-data-dir={slot}",
        "--dump-dom",
        "http://127.0.0.1:8765/render.html?m=" + ",".join(batch),
    ]
    dom = ""
    try:
        # A headless Chrome very occasionally hangs; give each batch two tries.
        for attempt in range(2):
            try:
                dom = subprocess.run(cmd, capture_output=True, text=True, timeout=900).stdout
                break
            except subprocess.TimeoutExpired:
                print(",".join(batch), "timed out" + (", retrying" if attempt == 0 else ""), flush=True)
    finally:
        SLOTS.put(slot)
    found = dict(re.findall(r'<pre data-job="([^"]+)">([^<]*)</pre>', dom))
    for job in batch:
        text = found.get(job, "")
        if not text.startswith("data:image/png;base64,"):
            print(job, "FAILED", text[:800] or dom[:800], flush=True)
            continue
        data = base64.b64decode(text.split(",", 1)[1])
        (OUT / file_name(job)).write_bytes(data)
        print(job, "ok", file_name(job), len(data), "bytes", flush=True)


with ThreadPoolExecutor(parallel) as pool:
    list(pool.map(run, batches))
PROFILES.cleanup()
