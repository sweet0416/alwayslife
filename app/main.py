from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .parser import FootprintError, load_config, parse_footprints


app = FastAPI(title="Life Footprint Map")

app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse("app/static/index.html")


@app.get("/api/config")
def api_config() -> dict[str, str]:
    config = load_config()
    return {
        "tile_url": config["tile_url"],
        "tile_attribution": config["tile_attribution"],
    }


@app.get("/api/footprints")
def api_footprints() -> JSONResponse:
    try:
        return JSONResponse(parse_footprints())
    except FootprintError as error:
        return JSONResponse(
            status_code=404 if error.code == "missing_csv" else 422,
            content={"error": error.code, "message": error.message},
        )

