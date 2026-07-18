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
    "time": ["\u65f6\u95f4", "\u65e5\u671f", "timestamp", "time", "date", "datetime", "dataTime", "\u8bb0\u5f55\u65f6\u95f4", "\u521b\u5efa\u65f6\u95f4"],
    "longitude": ["\u7ecf\u5ea6", "longitude", "lng", "lon", "long", "x"],
    "latitude": ["\u7eac\u5ea6", "latitude", "lat", "y"],
    "address": ["\u5730\u5740", "address", "\u4f4d\u7f6e", "\u5730\u70b9", "place", "name"],
    "city": ["\u57ce\u5e02", "city", "\u5e02"],
    "province": ["\u7701\u4efd", "province", "state", "\u7701", "\u884c\u653f\u533a"],
    "country": ["\u56fd\u5bb6", "country", "\u56fd\u5bb6/\u5730\u533a", "region"],
    "altitude": ["\u6d77\u62d4", "altitude", "alt", "elevation"],
    "speed": ["\u901f\u5ea6", "speed"],
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

_CACHE: dict[str, Any] = {}


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
        raise FootprintError("missing_csv", "\u8bf7\u628a\u4e00\u751f\u8db3\u8ff9\u5bfc\u51fa\u7684 CSV \u653e\u5230 data/footprint.csv\u3002")

    stat = csv_path.stat()
    cache_key = str(csv_path.resolve())
    cached = _CACHE.get(cache_key)
    if cached and cached["mtime"] == stat.st_mtime and cached["size"] == stat.st_size:
        return cached["data"]

    data = read_csv(csv_path, config)
    _CACHE[cache_key] = {"mtime": stat.st_mtime, "size": stat.st_size, "data": data}
    return data


def read_csv(csv_path: Path, config: dict[str, Any]) -> dict[str, Any]:
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
                "\u65e0\u6cd5\u8bc6\u522b\u7ecf\u7eac\u5ea6\u5b57\u6bb5\uff0c\u8bf7\u590d\u5236 config.example.json \u4e3a config.json \u5e76\u914d\u7f6e field_mapping\u3002",
            )

        points = [point for row in reader if (point := normalize_row(row, mapping))]

    points.sort(key=lambda item: item.get("timestamp_sort") or "")
    for point in points:
        point.pop("timestamp_sort", None)

    return {
        "points": points,
        "stats": build_stats(points),
        "fields": {"headers": headers, "mapping": mapping},
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
    display_time = format_time(parsed_time) if parsed_time else raw_time
    city = get_value(row, mapping.get("city"))
    province = get_value(row, mapping.get("province"))
    country = get_value(row, mapping.get("country"))
    address = get_value(row, mapping.get("address"))

    known_fields = {field for field in mapping.values() if field}
    extras = {key: value for key, value in row.items() if key not in known_fields and value not in (None, "")}

    return {
        "time": raw_time,
        "display_time": display_time,
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
    dates = sorted({point["date"] for point in dated if point.get("date")})
    bounds = None

    if points:
        bounds = {
            "south": min(point["latitude"] for point in points),
            "west": min(point["longitude"] for point in points),
            "north": max(point["latitude"] for point in points),
            "east": max(point["longitude"] for point in points),
        }

    return {
        "total_points": len(points),
        "city_count": len(cities),
        "country_count": len(countries),
        "earliest_time": dated[0]["display_time"] if dated else "",
        "latest_time": dated[-1]["display_time"] if dated else "",
        "bounds": bounds,
        "dates": dates,
    }


def select_footprints(
    data: dict[str, Any],
    *,
    start: str = "",
    end: str = "",
    day: str = "",
    west: float | None = None,
    south: float | None = None,
    east: float | None = None,
    north: float | None = None,
    limit: int = 12000,
) -> dict[str, Any]:
    selected = [
        point
        for point in data["points"]
        if matches_date(point, start=start, end=end, day=day)
        and matches_bounds(point, west=west, south=south, east=east, north=north)
    ]
    total = len(selected)
    sampled = sample_points(selected, limit) if limit > 0 else selected
    return {
        "points": sampled,
        "total_matched": total,
        "sampled": len(sampled) < total,
        "returned": len(sampled),
    }


def matches_date(point: dict[str, Any], *, start: str, end: str, day: str) -> bool:
    date = point.get("date") or ""
    if day and date != day:
        return False
    if start and date and date < start:
        return False
    if end and date and date > end:
        return False
    return True


def matches_bounds(
    point: dict[str, Any],
    *,
    west: float | None,
    south: float | None,
    east: float | None,
    north: float | None,
) -> bool:
    if None in (west, south, east, north):
        return True
    lat = point["latitude"]
    lon = point["longitude"]
    if lat < south or lat > north:
        return False
    if west <= east:
        return west <= lon <= east
    return lon >= west or lon <= east


def sample_points(points: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    if limit <= 0 or len(points) <= limit:
        return points
    step = len(points) / limit
    sampled = [points[int(index * step)] for index in range(limit)]
    if sampled[-1] is not points[-1]:
        sampled[-1] = points[-1]
    return sampled


def parse_time(value: str) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None

    if text.isdigit():
        try:
            number: int | float = int(text)
            if number > 10_000_000_000:
                number = number / 1000
            return datetime.fromtimestamp(number)
        except (OSError, OverflowError, ValueError):
            pass

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


def format_time(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S")


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
