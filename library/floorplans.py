"""从图书馆官方楼层平面图（lbcone.hkust.edu.hk/floorplans，公开，不用登录）抓各层的房间位置。

  uv run python library/floorplans.py      # 写 docs/library/floorplans.json + docs/library/maps/<楼层>.jpg

平面图每层一张 PNG，页面里每个地点是一个绝对定位的 div（#place_N{top;left;width;height}），
坐标以图片宽 1600px 为基准（LG5 的图是 2146px 宽，坐标照样按 1600 缩放）。
官方 PNG 每张 0.5–1.2 MB、没有缓存头、加载要 3 秒左右，所以这里裁到有房间的那一块（至少 MIN_W × MIN_H）、
转成 JPEG 放在本站；矩形坐标换成裁剪后图片里的像素。房间布局很少变，偶尔手动重跑即可（make maps）。
"""
import json
import re
import subprocess
import tempfile
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

BASE = "https://lbcone.hkust.edu.hk"
FLOORS = {"1f": "1/F", "lg1": "LG1", "lg3": "LG3", "lg4": "LG4", "lg5": "LG5"}  # G/F 没有可预约的房间
BASIS = 1600  # 坐标基准宽度
OUT = Path(__file__).parent.parent / "docs" / "library" / "floorplans.json"
MAPS = OUT.parent / "maps"
MARGIN, MIN_W, MIN_H = 40, 640, 320  # 裁剪：房间外留白；楼层房间很少（1/F、LG5）时也至少这么大，带上周围参照
# 预约系统里的名字 → 平面图上的房间号（其余按房间号直接匹配）
ALIAS = {"LG1- Media and Discussion": "LG1-329", "LG3 Seminar": "LG3-10"}
POD_ZONE = "Study Pod Zone"  # Study Pods 在图上只有一整块区域


def get(url: str, raw=False):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read()
    return body if raw else body.decode()


def sips(*args):
    subprocess.run(["sips", *map(str, args)], check=True, capture_output=True)


def size(path) -> tuple[int, int]:
    out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
                         check=True, capture_output=True, text=True).stdout
    return int(re.search(r"pixelWidth: (\d+)", out)[1]), int(re.search(r"pixelHeight: (\d+)", out)[1])


def crop_box(rects: list, img_w: int, img_h: int) -> tuple[int, int, int, int]:
    """包住所有房间的矩形，加留白、补到最小尺寸（以房间为中心），不超出图片。"""
    x0 = min(r[0] for r in rects) - MARGIN
    y0 = min(r[1] for r in rects) - MARGIN
    x1 = max(r[0] + r[2] for r in rects) + MARGIN
    y1 = max(r[1] + r[3] for r in rects) + MARGIN
    w, h = max(x1 - x0, MIN_W), max(y1 - y0, MIN_H)
    x0 -= (w - (x1 - x0)) // 2
    y0 -= (h - (y1 - y0)) // 2
    w, h = min(w, img_w), min(h, img_h)
    x0, y0 = min(max(x0, 0), img_w - w), min(max(y0, 0), img_h - h)
    return x0, y0, w, h


def save_map(key: str, img_url: str, rects: list) -> tuple[int, int, int, int]:
    """下载官方 PNG → 缩到 BASIS 宽 → 裁剪 → JPEG，返回裁剪框（BASIS 坐标）。"""
    MAPS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / f"{key}.png"
        png.write_bytes(get(img_url, raw=True))
        if size(png)[0] != BASIS:
            sips("--resampleWidth", BASIS, png)
        box = crop_box(rects, *size(png))
        x0, y0, w, h = box
        sips("-c", h, w, "--cropOffset", y0, x0, png)
        sips("-s", "format", "jpeg", "-s", "formatOptions", 80, png, "--out", MAPS / f"{key}.jpg")
    return box


def floor(key: str) -> dict:
    html = get(f"{BASE}/floorplans/floor/view?name={key}")
    img = re.search(r'<img id="map" src="([^"]+)"', html)
    if not img:
        raise ValueError(f"{key}: 页面里没有平面图")
    titles = dict(re.findall(r'<div id="(place_\d+)" class="lib_obj" title="([^"]*)"', html))
    rects = {k: [int(v) for v in (l, t, w, h)] for k, t, l, w, h in re.findall(
        r"#(place_\d+)\{top:(\d+)px;left:(\d+)px;width:(\d+)px;height:(\d+)px;\}", html)}
    places = [(titles[k].strip(), rects[k]) for k in titles if k in rects]
    if not places:
        raise ValueError(f"{key}: 没解析到地点")
    return {"key": key, "name": FLOORS[key], "img": BASE + img.group(1), "basis": BASIS, "places": places}


def floor_of(name: str) -> str:
    """房间在哪层：1-350 → 1f，LG3-05 → lg3，LC-01 / POD-01 → lg1。"""
    if name.startswith(("LC-", "POD-")):
        return "lg1"
    m = re.match(r"(LG\d|1)[- ]", name)
    return (m.group(1).lower() if m.group(1) != "1" else "1f") if m else ""


def match(places: list, name: str):
    """预约系统房间名 → 平面图矩形 [left, top, width, height]。"""
    if name.startswith("POD-"):
        code = POD_ZONE
        hits = [r for t, r in places if t == POD_ZONE]
    else:
        code = ALIAS.get(name, name)
        # 房间号后面不能紧跟数字：LC-1 不能匹配 LC-110
        hits = [r for t, r in places if re.search(re.escape(code) + r"(?!\d)", t)]
    return hits[0] if hits else None


def main():
    data = [floor(k) for k in FLOORS]
    # 用最近一天的公开数据拿房间名单，检查每个可预约房间都在图上
    pub = sorted((OUT.parent / "data").glob("20*.json"))
    names = [r["name"] for a in json.loads(pub[-1].read_text())["areas"] for r in a["rooms"]] if pub else []
    out = []
    for f in data:
        rooms = {n: r for n in names if floor_of(n) == f["key"] and (r := match(f["places"], n))}
        if not rooms:
            continue
        x0, y0, w, h = save_map(f["key"], f["img"], list(rooms.values()))
        out.append({"key": f["key"], "name": f["name"], "img": f"maps/{f['key']}.jpg", "w": w, "h": h,
                    "rooms": {n: [l - x0, t - y0, rw, rh] for n, (l, t, rw, rh) in rooms.items()}})
    found = {n for f in out for n in f["rooms"]}
    missing = [n for n in names if n not in found]
    OUT.write_text(json.dumps({
        "source": f"{BASE}/floorplans/",
        "fetched_at": datetime.now(ZoneInfo("Asia/Hong_Kong")).isoformat(timespec="seconds"),
        "floors": out,
    }, ensure_ascii=False, indent=1))
    for f in out:
        kb = (MAPS / f"{f['key']}.jpg").stat().st_size // 1024
        print(f"{f['name']:4} rooms={len(f['rooms']):2}  map {f['w']}×{f['h']} {kb} KB")
    print("未匹配:", missing or "无")


if __name__ == "__main__":
    main()
