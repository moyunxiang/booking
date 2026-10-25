"""从图书馆官方楼层平面图（lbcone.hkust.edu.hk/floorplans，公开，不用登录）抓各层的房间位置。

  uv run python library/floorplans.py      # 写 docs/library/floorplans.json

平面图每层一张 PNG，页面里每个地点是一个绝对定位的 div（#place_N{top;left;width;height}），
坐标以图片宽 1600px 为基准（LG5 的图是 2146px 宽，坐标照样按 1600 缩放）。
这里只记坐标和图片地址，网页直接引用官方图片，不复制。房间布局很少变，偶尔手动重跑即可。
"""
import json
import re
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

BASE = "https://lbcone.hkust.edu.hk"
FLOORS = {"1f": "1/F", "lg1": "LG1", "lg3": "LG3", "lg4": "LG4", "lg5": "LG5"}  # G/F 没有可预约的房间
BASIS = 1600  # 坐标基准宽度
OUT = Path(__file__).parent.parent / "docs" / "library" / "floorplans.json"
# 预约系统里的名字 → 平面图上的房间号（其余按房间号直接匹配）
ALIAS = {"LG1- Media and Discussion": "LG1-329", "LG3 Seminar": "LG3-10"}
POD_ZONE = "Study Pod Zone"  # Study Pods 在图上只有一整块区域


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode()


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
        out.append({"key": f["key"], "name": f["name"], "img": f["img"], "basis": f["basis"], "rooms": rooms})
    found = {n for f in out for n in f["rooms"]}
    missing = [n for n in names if n not in found]
    OUT.write_text(json.dumps({
        "source": f"{BASE}/floorplans/",
        "fetched_at": datetime.now(ZoneInfo("Asia/Hong_Kong")).isoformat(timespec="seconds"),
        "floors": out,
    }, ensure_ascii=False, indent=1))
    for f in out:
        print(f"{f['name']:4} rooms={len(f['rooms'])}")
    print("未匹配:", missing or "无")


if __name__ == "__main__":
    main()
