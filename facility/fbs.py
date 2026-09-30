"""HKUST 体育设施预约系统（fbs.hkust.edu.hk，Drupal）的最小客户端。

直接复现页面上的 Drupal AJAX 表单请求：
  GET  /facilities                       → 拿 form_build_id / form_token
  POST /facilities?ajax_form=1&...        → 按条件搜索 / 选场地，返回要插入页面的 HTML
"""
import json
import re
import sys
import time
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent.parent))
from auth import FACILITY  # noqa: E402

AJAX = FACILITY + "facilities?ajax_form=1&_wrapper_format=drupal_ajax"


class SessionExpired(Exception):
    pass


class FBS:
    def __init__(self, ctx):
        self.ctx = ctx
        r = ctx.request.get(FACILITY + "facilities")
        if not r.url.startswith(FACILITY) or "casservice" in r.url or 'name="form_token"' not in r.text():
            raise SessionExpired
        soup = BeautifulSoup(r.text(), "lxml")
        f = soup.find("form", id=re.compile("fbs-facilities-booking-form"))
        self.build_id = f.find("input", attrs={"name": "form_build_id"})["value"]
        self.token = f.find("input", attrs={"name": "form_token"})["value"]

    def post(self, fields: dict, trigger: str, trigger_value: str | None = None) -> BeautifulSoup:
        data = {
            **fields,
            "form_build_id": self.build_id, "form_token": self.token, "form_id": "fbs_facilities_booking_form",
            "_triggering_element_name": trigger, "_drupal_ajax": "1",
            "ajax_page_state[theme]": "hkust_fbs", "ajax_page_state[theme_token]": "",
        }
        if trigger_value is not None:
            data["_triggering_element_value"] = trigger_value
        for attempt in range(4):  # 服务器偶尔 500 / 502，退避重试
            r = self.ctx.request.post(AJAX, form=data)
            if r.status < 500:
                break
            time.sleep(10 * (attempt + 1))
        if r.status != 200:
            raise RuntimeError(f"fbs ajax HTTP {r.status}")
        try:
            cmds = json.loads(r.text())
        except json.JSONDecodeError:
            raise SessionExpired
        html = ""
        for c in cmds:
            if c.get("command") == "update_build_id":
                self.build_id = c["new"]
            if c.get("command") == "insert" and c.get("data"):
                html += c["data"]
        return BeautifulSoup(html, "lxml")

    def search(self, ftype: str, date: str, location: str = "", facility: str = "") -> BeautifulSoup:
        # 和浏览器发的字段保持一致：空的 location / facility 不要带
        fields = {"facilities": ftype, "filters[facility_type]": ftype, "filters[date]": date}
        if location:
            fields["filters[location]"] = location
        if facility:
            fields["filters[facility]"] = facility
        return self.post(fields, "search", "Search")

    def select(self, ftype: str, date: str, court_id: int) -> BeautifulSoup:
        """相当于在搜索结果里点某个场地（需先 search 同一天）。"""
        fields = {"filters[facility_type]": ftype, "filters[date]": date}
        return self.post(fields, f"select_facility_{court_id}")


def calendar_available(soup) -> list[str]:
    """月历里标 Available 的日期。"""
    out = []
    for sp in soup.select("table.calendar span.availability.available"):
        m = re.search(r"\d{4}-\d\d-\d\d", sp.get("data-drupal-selector", ""))
        if m:
            out.append(m.group())
    return out


def courts(soup) -> list[dict]:
    """当天的场地列表：id、名字、地点、是否有空。"""
    out = []
    for it in soup.select("fieldset.facility .item"):
        btn = it.find("input", attrs={"name": re.compile(r"^select_facility_\d+$")})
        out.append({
            "id": int(btn["name"].rsplit("_", 1)[1]),
            "name": it.select_one(".name").get_text(strip=True),
            "location": it.select_one(".location").get_text(strip=True),
            "available": "not-available" not in it.get("class", []),
        })
    return out


def timeslots(soup) -> list[dict]:
    """选中场地后的时段列表：开始时间 + 是否可订。"""
    out = []
    for el in soup.select('input[name="selection[timeslot_wrapper][timeslots]"]'):
        out.append({"start": el["value"], "available": not el.has_attr("disabled")})
    return out
