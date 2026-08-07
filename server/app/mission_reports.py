"""Mission report generation and storage API for Task3.

Task3 receives capture results from the flight/capture step, renders a grouped
PDF for the customer, and keeps a per-user report index for later download.
"""

from __future__ import annotations

import base64
import binascii
import math
import re
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from PIL import Image as PILImage
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import CONFIG
from .db import get_async_session
from .models import MissionReport, User
from .users import current_active_user

router = APIRouter(tags=["mission-reports"])

DATA_URL_RE = re.compile(r"^data:(?P<mime>[-\w.+/]+);base64,(?P<data>.+)$", re.DOTALL)
MAX_LOCATIONS = 12
MAX_CAPTURES = 80
MAX_IMAGE_BYTES = 8 * 1024 * 1024
COLLISION_WARNING_METERS = 8.0
PDF_FONT_NAME = "STSong-Light"


class RoutePoint(BaseModel):
    model_config = ConfigDict(extra="allow")

    label: str | None = Field(default=None, max_length=120)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    alt: float | None = None


class RoutePlan(BaseModel):
    model_config = ConfigDict(extra="allow")

    origin: RoutePoint | None = None
    destination: RoutePoint | None = None
    mode: Literal["walk", "drive", "fly", "teleport", "mixed"] = "walk"
    distanceMeters: float | None = Field(default=None, ge=0)
    durationMinutes: float | None = Field(default=None, ge=0)
    instructions: list[str] = Field(default_factory=list, max_length=24)


class CapturePhoto(BaseModel):
    model_config = ConfigDict(extra="allow")

    filename: str | None = Field(default=None, max_length=180)
    contentType: str = Field(default="image/png", max_length=80)
    dataUrl: str | None = None
    imageUrl: str | None = Field(default=None, max_length=2048)
    droneId: str | None = Field(default=None, max_length=120)
    vantageLabel: str | None = Field(default=None, max_length=160)
    capturedAt: datetime | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    alt: float | None = None
    yaw: float | None = None
    pitch: float | None = None
    roll: float | None = None
    note: str | None = Field(default=None, max_length=800)

    @field_validator("dataUrl")
    @classmethod
    def validate_data_url(cls, value: str | None) -> str | None:
        if not value:
            return value
        match = DATA_URL_RE.match(value)
        if not match:
            raise ValueError("image must be a data URL")
        try:
            decoded_size = len(base64.b64decode(match.group("data"), validate=True))
        except (binascii.Error, ValueError) as error:
            raise ValueError("image data is not valid base64") from error
        if decoded_size > MAX_IMAGE_BYTES:
            raise ValueError("image exceeds 8 MB")
        return value


class ObservationLocation(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str | None = Field(default=None, max_length=120)
    title: str = Field(min_length=1, max_length=180)
    address: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=1200)
    route: RoutePlan | None = None
    captures: list[CapturePhoto] = Field(default_factory=list, max_length=MAX_CAPTURES)


class MissionReportCreate(BaseModel):
    model_config = ConfigDict(extra="allow")

    title: str = Field(min_length=1, max_length=180)
    summary: str | None = Field(default=None, max_length=2000)
    roomId: str | None = Field(default=None, max_length=120)
    missionId: str | None = Field(default=None, max_length=160)
    locations: list[ObservationLocation] = Field(min_length=1, max_length=MAX_LOCATIONS)

    @model_validator(mode="after")
    def limit_total_captures(self) -> "MissionReportCreate":
        total = sum(len(location.captures) for location in self.locations)
        if total > MAX_CAPTURES:
            raise ValueError(f"a report can include at most {MAX_CAPTURES} captures")
        return self


class MissionReportSummary(BaseModel):
    id: uuid.UUID
    title: str
    summary: str | None
    roomId: str | None = None
    missionId: str | None = None
    locationCount: int
    captureCount: int
    pdfUrl: str
    createdAt: datetime
    updatedAt: datetime


class MissionReportDetail(MissionReportSummary):
    reportPayload: dict[str, Any]


def storage_root() -> Path:
    configured = CONFIG.get("reports", {}).get("storage_dir")
    if configured:
        root = Path(configured).expanduser()
    else:
        root = Path(__file__).resolve().parent.parent / "generated" / "reports"
    return root.resolve()


def decode_data_url(data_url: str) -> tuple[str, bytes]:
    match = DATA_URL_RE.match(data_url)
    if not match:
        raise ValueError("image must be a data URL")
    return match.group("mime"), base64.b64decode(match.group("data"), validate=True)


def haversine_meters(origin: RoutePoint, destination: RoutePoint) -> float | None:
    if None in (origin.lat, origin.lon, destination.lat, destination.lon):
        return None
    lat1 = math.radians(float(origin.lat))
    lat2 = math.radians(float(destination.lat))
    dlat = lat2 - lat1
    dlon = math.radians(float(destination.lon) - float(origin.lon))
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6_371_000 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def bearing_degrees(origin: RoutePoint, destination: RoutePoint) -> float | None:
    if None in (origin.lat, origin.lon, destination.lat, destination.lon):
        return None
    lat1 = math.radians(float(origin.lat))
    lat2 = math.radians(float(destination.lat))
    dlon = math.radians(float(destination.lon) - float(origin.lon))
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def route_summary(route: RoutePlan | None) -> dict[str, Any] | None:
    if not route:
        return None
    origin = route.origin
    destination = route.destination
    computed_distance = haversine_meters(origin, destination) if origin and destination else None
    computed_bearing = bearing_degrees(origin, destination) if origin and destination else None
    distance = route.distanceMeters if route.distanceMeters is not None else computed_distance
    return {
        "mode": route.mode,
        "origin": origin.model_dump() if origin else None,
        "destination": destination.model_dump() if destination else None,
        "distanceMeters": distance,
        "durationMinutes": route.durationMinutes,
        "bearingDegrees": computed_bearing,
        "instructions": route.instructions,
    }


def _capture_position(capture: CapturePhoto) -> tuple[float, float, float] | None:
    if capture.lat is None or capture.lon is None:
        return None
    return (float(capture.lat), float(capture.lon), float(capture.alt or 0))


def _capture_distance(a: CapturePhoto, b: CapturePhoto) -> float | None:
    pos_a = _capture_position(a)
    pos_b = _capture_position(b)
    if not pos_a or not pos_b:
        return None
    geo = haversine_meters(
        RoutePoint(lat=pos_a[0], lon=pos_a[1]),
        RoutePoint(lat=pos_b[0], lon=pos_b[1]),
    )
    if geo is None:
        return None
    return math.hypot(geo, pos_a[2] - pos_b[2])


def collision_summary(locations: list[ObservationLocation], threshold: float = COLLISION_WARNING_METERS) -> dict[str, Any]:
    warnings: list[dict[str, Any]] = []
    checked_pairs = 0
    for location in locations:
        captures = [capture for capture in location.captures if _capture_position(capture)]
        for index, first in enumerate(captures):
            for second in captures[index + 1:]:
                if first.droneId and second.droneId and first.droneId == second.droneId:
                    continue
                checked_pairs += 1
                distance = _capture_distance(first, second)
                if distance is not None and distance < threshold:
                    warnings.append({
                        "locationTitle": location.title,
                        "firstDroneId": first.droneId,
                        "secondDroneId": second.droneId,
                        "distanceMeters": round(distance, 2),
                    })
    return {
        "thresholdMeters": threshold,
        "checkedPairs": checked_pairs,
        "warningCount": len(warnings),
        "warnings": warnings[:20],
        "status": "warning" if warnings else "clear" if checked_pairs else "insufficient_telemetry",
    }


def summarize_payload(payload: MissionReportCreate) -> dict[str, Any]:
    locations = []
    for location in payload.locations:
        locations.append({
            "id": location.id,
            "title": location.title,
            "address": location.address,
            "description": location.description,
            "route": route_summary(location.route),
            "captureCount": len(location.captures),
            "captures": [
                capture.model_dump(mode="json", exclude={"dataUrl"})
                for capture in location.captures
            ],
        })
    return {
        "title": payload.title,
        "summary": payload.summary,
        "roomId": payload.roomId,
        "missionId": payload.missionId,
        "locationCount": len(payload.locations),
        "captureCount": sum(len(location.captures) for location in payload.locations),
        "locations": locations,
        "safety": collision_summary(payload.locations),
    }


def pdf_styles() -> dict[str, ParagraphStyle]:
    try:
        pdfmetrics.registerFont(UnicodeCIDFont(PDF_FONT_NAME))
    except Exception:
        # The font registry is process-wide; duplicate registration is harmless.
        pass
    base = getSampleStyleSheet()
    for style in base.byName.values():
        style.fontName = PDF_FONT_NAME
    return {
        "title": ParagraphStyle(
            "ReportTitle",
            parent=base["Title"],
            fontName=PDF_FONT_NAME,
            fontSize=22,
            leading=28,
            alignment=TA_CENTER,
            spaceAfter=12,
        ),
        "h1": ParagraphStyle("ReportHeading", parent=base["Heading1"], fontName=PDF_FONT_NAME, fontSize=17, leading=22),
        "h2": ParagraphStyle("ReportSubheading", parent=base["Heading2"], fontName=PDF_FONT_NAME, fontSize=13, leading=17),
        "body": ParagraphStyle("ReportBody", parent=base["BodyText"], fontName=PDF_FONT_NAME, fontSize=10, leading=14),
        "small": ParagraphStyle("ReportSmall", parent=base["BodyText"], fontName=PDF_FONT_NAME, fontSize=8.5, leading=11),
    }


def safe_text(value: Any, fallback: str = "-") -> str:
    text = "" if value is None else str(value)
    return text.strip() or fallback


def number_text(value: float | None, suffix: str = "", digits: int = 2) -> str:
    if value is None:
        return "-"
    return f"{value:.{digits}f}{suffix}"


def make_table(rows: list[list[Any]], styles: dict[str, ParagraphStyle], widths: list[float] | None = None) -> Table:
    wrapped = [[Paragraph(safe_text(cell), styles["small"]) for cell in row] for row in rows]
    table = Table(wrapped, colWidths=widths)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef4f8")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#23313d")),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#c7d3de")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


def image_flowable(capture: CapturePhoto, max_width: float, max_height: float) -> Image | None:
    if not capture.dataUrl:
        return None
    try:
        _, raw = decode_data_url(capture.dataUrl)
        with PILImage.open(BytesIO(raw)) as source:
            width, height = source.size
        scale = min(max_width / width, max_height / height, 1)
        return Image(BytesIO(raw), width=width * scale, height=height * scale)
    except Exception:
        return None


def build_report_pdf(payload: MissionReportCreate, output_path: Path) -> dict[str, Any]:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    summary = summarize_payload(payload)
    styles = pdf_styles()
    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        rightMargin=16 * mm,
        leftMargin=16 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=payload.title,
    )
    story: list[Any] = [
        Paragraph(payload.title, styles["title"]),
        Paragraph(f"Generated at {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", styles["small"]),
    ]
    if payload.summary:
        story.extend([Spacer(1, 5 * mm), Paragraph(payload.summary, styles["body"])])
    story.append(Spacer(1, 7 * mm))

    overview_rows = [
        ["Mission", safe_text(payload.missionId), "Room", safe_text(payload.roomId)],
        ["Locations", summary["locationCount"], "Photos", summary["captureCount"]],
        ["Safety status", summary["safety"]["status"], "Warnings", summary["safety"]["warningCount"]],
    ]
    story.append(make_table(overview_rows, styles, [28 * mm, 58 * mm, 28 * mm, 58 * mm]))
    story.append(Spacer(1, 7 * mm))

    for index, location in enumerate(payload.locations, 1):
        if index > 1:
            story.append(PageBreak())
        story.append(Paragraph(f"{index}. {location.title}", styles["h1"]))
        if location.address:
            story.append(Paragraph(f"Address: {location.address}", styles["body"]))
        if location.description:
            story.append(Paragraph(location.description, styles["body"]))
        route = route_summary(location.route)
        if route:
            story.extend([Spacer(1, 3 * mm), Paragraph("Route to observation point", styles["h2"])])
            route_rows = [
                ["Origin", safe_text(route.get("origin", {}).get("label") if route.get("origin") else None)],
                ["Destination", safe_text(route.get("destination", {}).get("label") if route.get("destination") else None)],
                ["Mode", route["mode"]],
                ["Distance", number_text(route.get("distanceMeters"), " m", 1)],
                ["Duration", number_text(route.get("durationMinutes"), " min", 1)],
                ["Bearing", number_text(route.get("bearingDegrees"), " deg", 0)],
            ]
            story.append(make_table(route_rows, styles, [38 * mm, 126 * mm]))
            if route.get("instructions"):
                for step, instruction in enumerate(route["instructions"], 1):
                    story.append(Paragraph(f"{step}. {instruction}", styles["small"]))
        story.extend([Spacer(1, 4 * mm), Paragraph("Captured views", styles["h2"])])
        if not location.captures:
            story.append(Paragraph("No photos were attached for this location.", styles["body"]))
            continue
        for capture_index, capture in enumerate(location.captures, 1):
            label = capture.vantageLabel or capture.filename or f"View {capture_index}"
            story.append(Paragraph(f"{capture_index}. {label}", styles["h2"]))
            meta_rows = [
                ["Drone", safe_text(capture.droneId), "Time", safe_text(capture.capturedAt)],
                ["Lat", number_text(capture.lat, digits=6), "Lon", number_text(capture.lon, digits=6)],
                ["Alt", number_text(capture.alt, " m", 1), "Yaw", number_text(capture.yaw, " deg", 0)],
                ["Pitch", number_text(capture.pitch, " deg", 0), "Roll", number_text(capture.roll, " deg", 0)],
            ]
            story.append(make_table(meta_rows, styles, [24 * mm, 62 * mm, 24 * mm, 62 * mm]))
            image = image_flowable(capture, max_width=170 * mm, max_height=95 * mm)
            story.append(Spacer(1, 2 * mm))
            if image:
                story.append(image)
            else:
                story.append(Paragraph("Image data was not embedded or could not be read.", styles["small"]))
            if capture.note:
                story.append(Paragraph(capture.note, styles["small"]))
            story.append(Spacer(1, 4 * mm))

    safety = summary["safety"]
    story.append(PageBreak())
    story.append(Paragraph("Safety and collision spacing", styles["h1"]))
    story.append(Paragraph(
        f"Checked pairs: {safety['checkedPairs']}; warning threshold: {safety['thresholdMeters']} m.",
        styles["body"],
    ))
    if safety["warnings"]:
        rows = [["Location", "Drone A", "Drone B", "Distance"]]
        rows.extend([
            [
                item["locationTitle"],
                safe_text(item["firstDroneId"]),
                safe_text(item["secondDroneId"]),
                f"{item['distanceMeters']} m",
            ]
            for item in safety["warnings"]
        ])
        story.append(make_table(rows, styles, [56 * mm, 38 * mm, 38 * mm, 32 * mm]))
    else:
        story.append(Paragraph(
            "No close-approach warning was found in the submitted telemetry. "
            "If captures have no coordinates, this only means spacing could not be verified from the report payload.",
            styles["body"],
        ))

    doc.build(story)
    return summary


def summary_from_model(report: MissionReport) -> MissionReportSummary:
    payload = report.report_payload or {}
    return MissionReportSummary(
        id=report.id,
        title=report.title,
        summary=report.summary,
        roomId=payload.get("roomId"),
        missionId=payload.get("missionId"),
        locationCount=int(payload.get("locationCount") or 0),
        captureCount=int(payload.get("captureCount") or 0),
        pdfUrl=f"/api/reports/{report.id}/download",
        createdAt=report.created_at,
        updatedAt=report.updated_at,
    )


async def get_owned_report(
    report_id: uuid.UUID,
    user: User,
    session: AsyncSession,
) -> MissionReport:
    result = await session.execute(
        select(MissionReport).where(
            MissionReport.id == report_id,
            MissionReport.user_id == user.id,
        )
    )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="report_not_found")
    return report


@router.post("/reports", response_model=MissionReportSummary, status_code=201)
async def create_report(
    payload: MissionReportCreate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> MissionReportSummary:
    report_id = uuid.uuid4()
    output_path = storage_root() / str(user.id) / str(report_id) / "report.pdf"
    try:
        report_payload = build_report_pdf(payload, output_path)
    except Exception as error:
        raise HTTPException(status_code=400, detail="report_generation_failed") from error

    report = MissionReport(
        id=report_id,
        user_id=user.id,
        title=payload.title,
        summary=payload.summary,
        report_payload=report_payload,
        pdf_path=str(output_path),
    )
    session.add(report)
    await session.commit()
    await session.refresh(report)
    return summary_from_model(report)


@router.get("/reports", response_model=list[MissionReportSummary])
async def list_reports(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> list[MissionReportSummary]:
    result = await session.execute(
        select(MissionReport)
        .where(MissionReport.user_id == user.id)
        .order_by(MissionReport.created_at.desc())
    )
    return [summary_from_model(report) for report in result.scalars()]


@router.get("/reports/{report_id}", response_model=MissionReportDetail)
async def report_detail(
    report_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> MissionReportDetail:
    report = await get_owned_report(report_id, user, session)
    summary = summary_from_model(report).model_dump()
    return MissionReportDetail(**summary, reportPayload=report.report_payload or {})


@router.get("/reports/{report_id}/download")
async def download_report(
    report_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> FileResponse:
    report = await get_owned_report(report_id, user, session)
    path = Path(report.pdf_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="report_file_missing")
    filename = f"{report.title[:80] or 'mission-report'}.pdf"
    return FileResponse(path, media_type="application/pdf", filename=filename)
