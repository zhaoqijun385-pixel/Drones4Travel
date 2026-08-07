#!/usr/bin/env python3
"""Idempotently wire Tourism Survey (Tasks.pdf) into drone-navigation.

Safe to run repeatedly. Optional draft source directory via SURVEY_TASKS_SRC;
when unset, only patches wiring for files already present in the repo.
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

HOME = Path.home()
ROOT = HOME / "drone-navigation"


def _resolve_src() -> Path | None:
    """Optional external draft folder — never hard-require a machine-specific path."""
    env = (os.environ.get("SURVEY_TASKS_SRC") or "").strip()
    candidates: list[Path] = []
    if env:
        candidates.append(Path(env).expanduser())
    # Common local overrides (optional)
    candidates.extend(
        [
            ROOT / "tourism-survey-drafts",
            HOME / "tourism-survey-tasks",
            HOME / "旅游观测Tasks",
        ]
    )
    for c in candidates:
        if c.is_dir():
            return c
    return None


SRC = _resolve_src()


def _copy_if(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    try:
        print("copy", dst.relative_to(ROOT))
    except ValueError:
        print("copy", dst)


def ensure_module() -> None:
    dst = ROOT / "server/app/survey_mission.py"
    if SRC is not None:
        src = SRC / "_survey_mission.py"
        if src.exists():
            _copy_if(src, dst)
    if not dst.exists():
        raise SystemExit(
            "missing server/app/survey_mission.py "
            "(set SURVEY_TASKS_SRC to a drafts folder if you need to copy from outside the repo)"
        )


def ensure_main() -> None:
    main = ROOT / "server/app/main.py"
    t = main.read_text(encoding="utf-8")
    changed = False
    if "survey_mission" not in t:
        if "from .sim_arena import router as sim_arena_router" in t:
            t = t.replace(
                "from .sim_arena import router as sim_arena_router",
                "from .sim_arena import router as sim_arena_router\n"
                "from .survey_mission import router as survey_mission_router",
            )
            changed = True
        else:
            t = "from .survey_mission import router as survey_mission_router\n" + t
            changed = True
    if "include_router(survey_mission_router" not in t:
        anchor = 'app.include_router(sim_arena_router, prefix="/api")'
        block = (
            anchor
            + "\n\n# --- Tourism survey Task1/Task2 (sidelane; dry-run default) ---\n"
            + 'app.include_router(survey_mission_router, prefix="/api")'
        )
        if anchor in t:
            t = t.replace(anchor, block, 1)
            changed = True
        else:
            t += (
                "\n\nfrom .survey_mission import router as survey_mission_router  # noqa: E402\n"
                'app.include_router(survey_mission_router, prefix="/api")\n'
            )
            changed = True
    if changed:
        main.write_text(t, encoding="utf-8")
        print("patched main.py")
    else:
        print("main.py ok")


def ensure_router() -> None:
    rpath = ROOT / "client/src/router/index.js"
    rt = rpath.read_text(encoding="utf-8")
    changed = False
    if "SurveyMissionView" not in rt:
        if "import MissionArenaView from '@/views/MissionArenaView.vue';" in rt:
            rt = rt.replace(
                "import MissionArenaView from '@/views/MissionArenaView.vue';",
                "import MissionArenaView from '@/views/MissionArenaView.vue';\n"
                "import SurveyMissionView from '@/views/SurveyMissionView.vue';",
            )
            changed = True
        block = """  {
    path: '/mission-arena',
    name: 'MissionArena',
    component: MissionArenaView,
  },
];"""
        with_s = """  {
    path: '/mission-arena',
    name: 'MissionArena',
    component: MissionArenaView,
  },
  {
    path: '/survey-mission',
    name: 'SurveyMission',
    component: SurveyMissionView,
  },
];"""
        if block in rt:
            rt = rt.replace(block, with_s, 1)
            changed = True
        if changed:
            rpath.write_text(rt, encoding="utf-8")
            print("patched router")
        else:
            print("WARN router not patched")
    else:
        print("router ok")


def ensure_vite_proxy() -> None:
    vc = ROOT / "client/vite.config.js"
    t = vc.read_text(encoding="utf-8")
    if "'/api'" in t or '"/api"' in t:
        print("vite /api ok")
        return
    old = """    proxy: {
      // Same-origin reachability to the local Synapse homeserver — the SPA
      // never talks to Matrix anywhere else (Caddy mirrors this in prod).
      '/_matrix': {
        target: 'http://127.0.0.1:8008',
        changeOrigin: true,
      },
    },"""
    new = """    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        ws: true,
      },
      // Same-origin reachability to the local Synapse homeserver — the SPA
      // never talks to Matrix anywhere else (Caddy mirrors this in prod).
      '/_matrix': {
        target: 'http://127.0.0.1:8008',
        changeOrigin: true,
      },
    },"""
    if old not in t:
        print("WARN vite proxy pattern missing")
        return
    vc.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("patched vite /api")


def ensure_i18n_pages() -> None:
    views = ROOT / "client/src/views"
    for name, label in [
        ("AerialView.zh.i18n.json", "旅游观测"),
        ("AerialView.en.i18n.json", "Survey Mission"),
    ]:
        p = views / name
        if not p.exists():
            continue
        d = json.loads(p.read_text(encoding="utf-8"))
        if d.get("page_surveymission") != label:
            d["page_surveymission"] = label
            p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print("i18n", name)


def ensure_page_registry_hooks() -> None:
    """Undocumented soft hook — only when missionarena registration already exists."""
    views = ROOT / "client/src/views"
    mission = (
        "  registerPage({ id: 'missionarena', nameKey: 'aerialview.page_missionarena', "
        "route: '/mission-arena' });"
    )
    survey = (
        "  registerPage({ id: 'surveymission', nameKey: 'aerialview.page_surveymission', "
        "route: '/survey-mission' });"
    )
    for p in views.glob("*.vue"):
        t = p.read_text(encoding="utf-8")
        if mission not in t or "page_surveymission" in t:
            continue
        t = t.replace(mission, mission + "\n" + survey, 1)
        if "unregisterPage('missionarena')" in t and "unregisterPage('surveymission')" not in t:
            t = t.replace(
                "unregisterPage('missionarena');",
                "unregisterPage('missionarena');\n  unregisterPage('surveymission');",
            )
        p.write_text(t, encoding="utf-8")
        print("pages+", p.name)


def ensure_frontend_assets() -> None:
    if SRC is None:
        print("SURVEY_TASKS_SRC unset — skip draft asset copies (repo files used as-is)")
        return
    pairs = [
        (SRC / "_SurveyMissionView.vue", ROOT / "client/src/views/SurveyMissionView.vue"),
        (SRC / "_SurveyMissionView.zh.i18n.json", ROOT / "client/src/views/SurveyMissionView.zh.i18n.json"),
        (SRC / "_SurveyMissionView.en.i18n.json", ROOT / "client/src/views/SurveyMissionView.en.i18n.json"),
        (SRC / "_useSurveyCesium.js", ROOT / "client/src/survey/useSurveyCesium.js"),
    ]
    for s, d in pairs:
        _copy_if(s, d)


def main() -> None:
    if not ROOT.exists():
        raise SystemExit(f"missing {ROOT}")
    print("draft_src=", SRC or "(none)")
    ensure_module()
    ensure_main()
    ensure_router()
    ensure_vite_proxy()
    ensure_i18n_pages()
    ensure_page_registry_hooks()
    ensure_frontend_assets()
    print("ensure_survey_wired: DONE")


if __name__ == "__main__":
    main()
