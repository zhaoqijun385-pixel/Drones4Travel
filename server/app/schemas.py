"""Pydantic schemas exposed by the auth/user routers."""

import uuid
from typing import Literal

from fastapi_users import schemas
from pydantic import BaseModel, ConfigDict, Field


class UserRead(schemas.BaseUser[uuid.UUID]):
    display_name: str | None = None


class UserCreate(schemas.BaseUserCreate):
    password: str = Field(min_length=8, max_length=1024)
    display_name: str | None = Field(default=None, max_length=100)


class UserUpdate(schemas.BaseUserUpdate):
    display_name: str | None = Field(default=None, max_length=100)


# ─── Settings document (mirrors client/composables/useAppSettings.js) ────────
# One JSONB envelope per user, grouped like the Settings sidebar sections.
# extra="allow" keeps old/new frontends interoperable as the UI grows.


class FontSettings(BaseModel):
    model_config = ConfigDict(extra="allow")

    fontFamily: str = "Calibri"
    fontSize: str = "16px"


class FlightSettings(BaseModel):
    model_config = ConfigDict(extra="allow")

    # Ranges mirror the client-side setters in useAppSettings.js.
    takeoffAltitude: float = Field(100, ge=20, le=10000)
    safetyBuffer: float = Field(8, ge=0, le=100)
    defaultLat: float = Field(37.4286, ge=-90, le=90)
    defaultLon: float = Field(-122.1699, ge=-180, le=180)
    defaultAlt: float = 150
    defaultYaw: float = 180
    defaultPitch: float = Field(0, ge=-90, le=90)
    defaultRoll: float = Field(0, ge=-90, le=90)


class MediaSettings(BaseModel):
    model_config = ConfigDict(extra="allow")

    audioVolume: float = Field(0.9, ge=0, le=1)


class NetworkSettings(BaseModel):
    model_config = ConfigDict(extra="allow")

    enterpriseProxy: str = ""


class SettingsDocument(BaseModel):
    """Full settings envelope; PUT is a whole-document replace (upsert)."""

    model_config = ConfigDict(extra="allow")

    version: int = 1
    locale: str = "en"
    font: FontSettings = FontSettings()
    media: MediaSettings = MediaSettings()
    network: NetworkSettings = NetworkSettings()
    flight: FlightSettings = FlightSettings()


class OpenClawConversationCreate(BaseModel):
    agent_id: str = Field(default="main", min_length=1, max_length=100)
    session_key: str = Field(min_length=1, max_length=255)
    title: str | None = Field(default=None, max_length=160)


class OpenClawMessageCreate(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=40_000)
    external_id: str | None = Field(default=None, max_length=255)


# ---------------------------------------------------------------------------
# Tourism schemas
# ---------------------------------------------------------------------------

class TourismPlanRequest(BaseModel):
    """Accepts either a query string OR direct latitude/longitude."""
    query: str = Field(default="", max_length=200)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class PlaceInfo(BaseModel):
    name: str
    address: str
    latitude: float
    longitude: float


class ObservationPoint(BaseModel):
    latitude: float
    longitude: float
    altitude: float
    yaw: float


class PlaceSuggestion(BaseModel):
    place_id: str
    name: str
    address: str
    latitude: float | None = None
    longitude: float | None = None


class SuggestResponse(BaseModel):
    suggestions: list[PlaceSuggestion]


class NearbyPlace(BaseModel):
    place_id: str
    name: str
    address: str
    latitude: float
    longitude: float
    types: list[str] = []
    rating: float | None = None


class NearbySearchResponse(BaseModel):
    places: list[NearbyPlace]


class BatchPlaceItem(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class TourismBatchRequest(BaseModel):
    queries: list[str] = []
    places: list[BatchPlaceItem] = []


class BatchPlanItem(BaseModel):
    place: PlaceInfo
    observation_points: list[ObservationPoint]


class TourismBatchResponse(BaseModel):
    results: list[BatchPlanItem]


class StreetViewInfo(BaseModel):
    available: bool
    pano_id: str | None = None
    lat: float
    lng: float
