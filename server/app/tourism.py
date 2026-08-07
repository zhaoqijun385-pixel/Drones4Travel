"""Tourism observation endpoints.

Endpoints:
  GET  /api/tourism/suggest          Places Autocomplete (like navigation apps)
  GET  /api/tourism/places/nearby    Nearby search for similar locations
  POST /api/tourism/plan             Single-place observation planning
  POST /api/tourism/plan/batch       Multi-place batch planning
  GET  /api/tourism/streetview       Street View availability check

Geocoding and observation-point generation are reused from
``survey_mission`` (PR #11) so the two modules share one implementation
instead of duplicating each other.
"""

from __future__ import annotations

import logging
import math
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .schemas import (
    BatchPlanItem,
    BatchPlaceItem,
    NearbyPlace,
    NearbySearchResponse,
    ObservationPoint,
    PlaceInfo,
    PlaceSuggestion,
    StreetViewInfo,
    SuggestResponse,
    TourismBatchRequest,
    TourismBatchResponse,
    TourismPlanRequest,
)
from .survey_mission import (
    GeocodeError,
    _PLACE_HINTS,
    _geocode,
    _google_key,
    _viewpoints,
)

router = APIRouter(tags=["tourism"])
logger = logging.getLogger(__name__)

# Observation geometry (shared defaults with the survey mission module).
RADIUS_M = 200
ALTITUDE_SURROUND_M = 60
ALTITUDE_TOP_M = 120

_GOOGLE_PLACES_AUTOCOMPLETE_URL = "https://maps.googleapis.com/maps/api/place/autocomplete/json"
_GOOGLE_PLACES_NEARBY_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
_GOOGLE_STREETVIEW_META_URL = "https://maps.googleapis.com/maps/api/streetview/metadata"


def _create_http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=10.0),
        trust_env=True,
    )


def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in metres between two lat/lon pairs."""
    r = 6_371_000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _hint_label(label: str) -> str:
    return label.split(",")[0].strip() if label else label


# ---------------------------------------------------------------------------
# Mock fallbacks built from survey_mission's shared hint list
# ---------------------------------------------------------------------------

def _mock_places_autocomplete(query: str) -> list[PlaceSuggestion]:
    q = query.strip().lower()
    results: list[PlaceSuggestion] = []
    for key, (lat, lng, label) in _PLACE_HINTS.items():
        if q in key or q in label.lower():
            results.append(
                PlaceSuggestion(
                    place_id=f"hint-{key}",
                    name=_hint_label(label),
                    address=label,
                    latitude=lat,
                    longitude=lng,
                )
            )
    seen: set[str] = set()
    deduped: list[PlaceSuggestion] = []
    for suggestion in results:
        if suggestion.name in seen:
            continue
        seen.add(suggestion.name)
        deduped.append(suggestion)
    return deduped[:8]


def _mock_places_nearby(lat: float, lng: float, max_count: int = 5) -> list[NearbyPlace]:
    scored = [
        (_distance_m(lat, lng, plat, plng), key, plat, plng, label)
        for key, (plat, plng, label) in _PLACE_HINTS.items()
    ]
    scored.sort(key=lambda item: item[0])
    results: list[NearbyPlace] = []
    for _dist, key, plat, plng, label in scored[:max_count]:
        results.append(
            NearbyPlace(
                place_id=f"hint-{key}",
                name=_hint_label(label),
                address=label,
                latitude=plat,
                longitude=plng,
                types=["tourist_attraction"],
                rating=None,
            )
        )
    return results


# ---------------------------------------------------------------------------
# Google Places Autocomplete  (GET /api/tourism/suggest)
# ---------------------------------------------------------------------------

async def _google_places_autocomplete(query: str, language: str = "zh-CN") -> list[PlaceSuggestion]:
    api_key = _google_key()
    if not api_key:
        return _mock_places_autocomplete(query)

    params: dict[str, str] = {
        "input": query,
        "key": api_key,
        "language": language,
    }
    try:
        async with _create_http_client() as client:
            resp = await client.get(_GOOGLE_PLACES_AUTOCOMPLETE_URL, params=params)
            data: dict[str, Any] = resp.json()
    except Exception as exc:
        logger.exception("Google Places Autocomplete request failed")
        return _mock_places_autocomplete(query)

    status: str = data.get("status", "UNKNOWN")
    if status not in ("OK", "ZERO_RESULTS"):
        logger.warning("Google Places Autocomplete status=%s for query=%r", status, query)
        return _mock_places_autocomplete(query)

    predictions: list[dict[str, Any]] = data.get("predictions", [])
    suggestions: list[PlaceSuggestion] = []
    for pred in predictions[:8]:
        structured = pred.get("structured_formatting", {})
        suggestions.append(
            PlaceSuggestion(
                place_id=pred.get("place_id", ""),
                name=structured.get("main_text", pred.get("description", "")),
                address=structured.get("secondary_text", ""),
                latitude=None,
                longitude=None,
            )
        )
    return suggestions


@router.get("/tourism/suggest", response_model=SuggestResponse)
async def suggest_places(
    query: str = Query(min_length=1, max_length=200, description="Place name or address fragment"),
    language: str = Query(default="zh-CN", max_length=10),
) -> dict[str, Any]:
    """Autocomplete place search -- like typing an address in a navigation app."""
    try:
        suggestions = await _google_places_autocomplete(query, language)
    except Exception:
        logger.exception("suggest_places unexpected failure for query=%r", query)
        suggestions = _mock_places_autocomplete(query)
    return {"suggestions": suggestions}


# ---------------------------------------------------------------------------
# Google Places Nearby Search  (GET /api/tourism/places/nearby)
# ---------------------------------------------------------------------------

async def _google_places_nearby(
    lat: float, lng: float, radius: int = 1000, language: str = "zh-CN"
) -> list[NearbyPlace]:
    api_key = _google_key()
    if not api_key:
        return _mock_places_nearby(lat, lng)

    params: dict[str, Any] = {
        "location": f"{lat},{lng}",
        "radius": radius,
        "key": api_key,
        "language": language,
        "type": "tourist_attraction",
    }
    try:
        async with _create_http_client() as client:
            resp = await client.get(_GOOGLE_PLACES_NEARBY_URL, params=params)
            data: dict[str, Any] = resp.json()
    except Exception as exc:
        logger.exception("Google Places Nearby request failed")
        return _mock_places_nearby(lat, lng)

    status: str = data.get("status", "UNKNOWN")
    if status not in ("OK", "ZERO_RESULTS"):
        logger.warning("Google Places Nearby status=%s", status)
        return _mock_places_nearby(lat, lng)

    results: list[dict[str, Any]] = data.get("results", [])
    places: list[NearbyPlace] = []
    for item in results[:10]:
        geo = item.get("geometry", {}).get("location", {})
        places.append(
            NearbyPlace(
                place_id=item.get("place_id", ""),
                name=item.get("name", ""),
                address=item.get("vicinity", ""),
                latitude=geo.get("lat", 0.0),
                longitude=geo.get("lng", 0.0),
                types=item.get("types", []),
                rating=item.get("rating"),
            )
        )
    return places


@router.get("/tourism/places/nearby", response_model=NearbySearchResponse)
async def nearby_places(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    radius: int = Query(default=1000, ge=50, le=5000),
    language: str = Query(default="zh-CN", max_length=10),
) -> dict[str, Any]:
    """Find tourist attractions and similar places near a coordinate."""
    try:
        places = await _google_places_nearby(lat, lng, radius, language)
    except Exception:
        logger.exception("nearby_places unexpected failure at (%s, %s)", lat, lng)
        places = _mock_places_nearby(lat, lng)
    return {"places": places}


# ---------------------------------------------------------------------------
# Observation planning (reuses survey_mission viewpoint generation)
# ---------------------------------------------------------------------------

def _observation_points_for(lat: float, lng: float) -> list[ObservationPoint]:
    ring = _viewpoints(lat, lng, RADIUS_M, ALTITUDE_SURROUND_M, 4)
    points = [
        ObservationPoint(
            latitude=viewpoint["lat"],
            longitude=viewpoint["lng"],
            altitude=float(viewpoint["alt_m"]),
            yaw=float(viewpoint["yaw_deg"]),
        )
        for viewpoint in ring
    ]
    points.append(
        ObservationPoint(
            latitude=round(lat, 6),
            longitude=round(lng, 6),
            altitude=ALTITUDE_TOP_M,
            yaw=0.0,
        )
    )
    return points


class TourismPlanResponse(BaseModel):
    place: PlaceInfo
    observation_points: list[ObservationPoint]


@router.post("/tourism/plan", response_model=TourismPlanResponse)
async def plan_observation(request: TourismPlanRequest) -> dict[str, Any]:
    """Resolve a place (or use direct coordinates) and return 5 observation points."""
    if request.latitude is not None and request.longitude is not None:
        place = {
            "lat": request.latitude,
            "lng": request.longitude,
            "label": f"{request.latitude:.6f}, {request.longitude:.6f}",
        }
    else:
        try:
            place = _geocode(request.query)
        except GeocodeError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    points = _observation_points_for(float(place["lat"]), float(place["lng"]))
    return {
        "place": PlaceInfo(
            name=place["label"],
            address=place["label"],
            latitude=place["lat"],
            longitude=place["lng"],
        ),
        "observation_points": points,
    }


@router.post("/tourism/plan/batch", response_model=TourismBatchResponse)
async def plan_observation_batch(request: TourismBatchRequest) -> dict[str, Any]:
    """Resolve multiple places (queries or direct coordinates) and return observation points."""
    results: list[dict[str, Any]] = []

    for item in request.places:
        results.append(
            {
                "place": PlaceInfo(
                    name=f"{item.latitude:.6f}, {item.longitude:.6f}",
                    address=f"{item.latitude:.6f}, {item.longitude:.6f}",
                    latitude=item.latitude,
                    longitude=item.longitude,
                ),
                "observation_points": _observation_points_for(item.latitude, item.longitude),
            }
        )

    for query in request.queries:
        try:
            place = _geocode(query.strip())
        except GeocodeError:
            logger.warning("Could not geocode query=%r, skipping", query)
            continue
        results.append(
            {
                "place": PlaceInfo(
                    name=place["label"],
                    address=place["label"],
                    latitude=place["lat"],
                    longitude=place["lng"],
                ),
                "observation_points": _observation_points_for(float(place["lat"]), float(place["lng"])),
            }
        )
    return {"results": results}


# ---------------------------------------------------------------------------
# Street View availability  (GET /api/tourism/streetview)
# ---------------------------------------------------------------------------

@router.get("/tourism/streetview", response_model=StreetViewInfo)
async def check_streetview(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    radius: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    """Check if Google Street View imagery is available at the given coordinates."""
    api_key = _google_key()
    if not api_key:
        return {"available": False, "pano_id": None, "lat": lat, "lng": lng}

    params: dict[str, Any] = {
        "location": f"{lat},{lng}",
        "radius": radius,
        "key": api_key,
    }
    try:
        async with _create_http_client() as client:
            resp = await client.get(_GOOGLE_STREETVIEW_META_URL, params=params)
            data: dict[str, Any] = resp.json()
    except Exception:
        logger.exception("Street View metadata request failed")
        return {"available": False, "pano_id": None, "lat": lat, "lng": lng}

    status: str = data.get("status", "UNKNOWN")
    pano_id = data.get("pano_id")
    if status == "OK":
        location = data.get("location", {})
        return {
            "available": bool(pano_id),
            "pano_id": pano_id,
            "lat": location.get("lat", lat),
            "lng": location.get("lng", lng),
        }
    return {"available": False, "pano_id": None, "lat": lat, "lng": lng}
