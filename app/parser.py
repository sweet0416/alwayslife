from __future__ import annotations

import csv
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any


DEFAULT_CSV_PATH = Path(os.getenv("FOOTPRINT_CSV", "./data/footprint.csv"))
DEFAULT_CONFIG_PATH = Path(os.getenv("FOOTPRINT_CONFIG", "./config.json"))

FIELD_ALIASES: dict[str, list[str]] = {
    "time": ["时间", "日期", "timestamp", "time", "date", "datetime", "记录时间", "创建时间"],
    "longitude": ["经度", "longitude", "lng", "lon", "long", "x"],
    "latitude": ["纬度", "latitude", "lat", "y"],
    "address": ["地址", "address", "位置", "地点", "place", "name"],
    "city": ["城市", "city", "市"],
    "province": ["省份", "province", "state", "省", "行政区"],
    "country": ["国家", "country", "国家/地区", "region"],
    "altitude": ["海拔", "altitude", "alt", "elevation"],
    "speed": ["速度", "speed"],
}

TIME_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y/%m/%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y/%m/%d %H:%M",
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%Y.%m.%d %H:%M:%S",
    "%Y.%m.%d",
)


class FootprintError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def load_config(path: Path = DEFAULT_CONFIG_PATH) -> dict[str, Any]:
    config: dict[str, Any] = {}
    if path.exists():
        with path.open("r", encoding="utf-8-sig") as file:
            config = json.load(file)

    config.setdefault("csv_path", str(DEFAULT_CSV_PATH))
    config.setdefault("tile_url", os.getenv("TILE_URL", "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"))
    config.setdefault("tile_attribution", os.getenv("TILE_ATTRIBUTION", "&copy; OpenStreetMap contributors"))
    config.setdefault("field_mapping", {})
    return config


def parse_footprints() -> dict[str, Any]:
    config = load_config()
    csv_path = Path(os.getenv("FOOTPRINT_CSV", config.get("csv_path", str(DEFAULT_CSV_PATH))))

    if not csv_path.exists():
        raise FootprintError(
            "missing_csv",
            "请把一生足迹导出的 CSV 放到 data/footprint.csv。",
        )

    with csv_path.open("r", encoding="utf-8-sig", newline="") as file:
        sample = file.read(4096)
        file.seek(0)
        dialect = csv.Sniffer().sniff(sample) if sample.strip() else csv.excel
        reader = csv.DictReader(file, dialect=dialect)
        headers = reader.fieldnames or []
        mapping = resolve_field_mapping(headers, config.get("field_mapping", {}))

        if not mapping.get("longitude") or not mapping.get("latitude"):
            raise FootprintError(
                "mapping_failed",
                "无法识别经纬度字段，请复制 config.example.json 为 config.json 并配置 field_mapping。",
            )

        points = [point for row in reader if (point := normalize_row(row, mapping))]

    points.sort(key=lambda item: item.get("timestamp_sort") or "")
    for point in points:
        point.pop("timestamp_sort", None)

    return {
        "points": points,
        "stats": build_stats(points),
        "fields": {
            "headers": headers,
            "mapping": mapping,
        },
    }


def resolve_field_mapping(headers: list[str], manual_mapping: dict[str, str]) -> dict[str, str | None]:
    normalized_headers = {normalize_name(header): header for header in headers}
    mapping: dict[str, str | None] = {}

    for target, aliases in FIELD_ALIASES.items():
        manual = (manual_mapping or {}).get(target)
        if manual and manual in headers:
            mapping[target] = manual
            continue

        mapping[target] = None
        for alias in aliases:
            if normalize_name(alias) in normalized_headers:
                mapping[target] = normalized_headers[normalize_name(alias)]
                break

    return mapping


def normalize_row(row: dict[str, str], mapping: dict[str, str | None]) -> dict[str, Any] | None:
    lon = parse_float(get_value(row, mapping.get("longitude")))
    lat = parse_float(get_value(row, mapping.get("latitude")))
    if lon is None or lat is None or not (-180 <= lon <= 180) or not (-90 <= lat <= 90):
        return None

    raw_time = get_value(row, mapping.get("time"))
    parsed_time = parse_time(raw_time)
    city = get_value(row, mapping.get("city"))
    province = get_value(row, mapping.get("province"))
    country = get_value(row, mapping.get("country"))
    address = get_value(row, mapping.get("address"))

    known_fields = {field for field in mapping.values() if field}
    extras = {
        key: value
        for key, value in row.items()
        if key not in known_fields and value not in (None, "")
    }

    return {
        "time": raw_time,
        "date": parsed_time.date().isoformat() if parsed_time else "",
        "timestamp": parsed_time.isoformat() if parsed_time else "",
        "timestamp_sort": parsed_time.isoformat() if parsed_time else raw_time,
        "longitude": lon,
        "latitude": lat,
        "address": address,
        "city": city,
        "province": province,
        "country": country,
        "altitude": parse_float(get_value(row, mapping.get("altitude"))),
        "speed": parse_float(get_value(row, mapping.get("speed"))),
        "extra": extras,
    }


def build_stats(points: list[dict[str, Any]]) -> dict[str, Any]:
    dated = [point for point in points if point.get("timestamp")]
    cities = {point["city"] for point in points if point.get("city")}
    countries = {point["country"] for point in points if point.get("country")}

    return {
        "total_points": len(points),
        "city_count": len(cities),
        "country_count": len(countries),
        "earliest_time": dated[0]["time"] if dated else "",
        "latest_time": dated[-1]["time"] if dated else "",
    }


def parse_time(value: str) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None

    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        pass

    for fmt in TIME_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def parse_float(value: str) -> float | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def get_value(row: dict[str, str], field: str | None) -> str:
    if not field:
        return ""
    return (row.get(field) or "").strip()


def normalize_name(value: str) -> str:
    return (value or "").strip().lower().replace(" ", "").replace("_", "").replace("-", "")

