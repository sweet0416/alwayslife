from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .parser import FootprintError, load_config, parse_footprints, select_footprints


app = FastAPI(title="Life Footprint Map")
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse("app/static/index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
def api_config() -> dict[str, str]:
    config = load_config()
    return {
        "tile_url": config["tile_url"],
        "tile_attribution": config["tile_attribution"],
    }


@app.get("/api/summary")
def api_summary() -> JSONResponse:
    try:
        data = parse_footprints()
        return JSONResponse({"stats": data["stats"], "fields": data["fields"]})
    except FootprintError as error:
        return JSONResponse(
            status_code=404 if error.code == "missing_csv" else 422,
            content={"error": error.code, "message": error.message},
        )


@app.get("/api/footprints")
def api_footprints(
    start: str = "",
    end: str = "",
    day: str = "",
    west: float | None = None,
    south: float | None = None,
    east: float | None = None,
    north: float | None = None,
    limit: int = 12000,
) -> JSONResponse:
    try:
        data = parse_footprints()
        selection = select_footprints(
            data,
            start=start,
            end=end,
            day=day,
            west=west,
            south=south,
            east=east,
            north=north,
            limit=max(0, min(limit, 100000)),
        )
        return JSONResponse({"stats": data["stats"], "fields": data["fields"], **selection})
    except FootprintError as error:
        return JSONResponse(
            status_code=404 if error.code == "missing_csv" else 422,
            content={"error": error.code, "message": error.message},
        )
