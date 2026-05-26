#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import re
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_WORKTREE = ROOT / ".worktrees" / "firefox-ios"
ZAPPA_PACKAGE_SOURCES = ROOT / "ios" / "ZappaRewriteKit" / "Sources" / "ZappaRewriteKit"
FIREFOX_OVERLAY = ROOT / "ios" / "firefox-ios-overlay"


def main() -> None:
    worktree = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_WORKTREE
    firefox_root = worktree / "firefox-ios"
    client_root = firefox_root / "Client"
    zappa_root = client_root / "Frontend" / "Zappa"
    project_path = firefox_root / "Client.xcodeproj" / "project.pbxproj"
    browser_view_controller = (
        client_root
        / "Frontend"
        / "Browser"
        / "BrowserViewController"
        / "Views"
        / "BrowserViewController.swift"
    )

    require(project_path)
    require(browser_view_controller)
    zappa_root.mkdir(parents=True, exist_ok=True)

    swift_files: list[Path] = []
    for source in sorted(ZAPPA_PACKAGE_SOURCES.glob("*.swift")):
        destination = zappa_root / source.name
        shutil.copy2(source, destination)
        swift_files.append(destination)
    for source in sorted(FIREFOX_OVERLAY.glob("*.swift")):
        destination = zappa_root / source.name
        shutil.copy2(source, destination)
        swift_files.append(destination)

    patch_browser_view_controller(browser_view_controller)
    patch_project(project_path, swift_files, firefox_root)

    print(f"Applied Zappa overlay to {worktree}")
    print(f"Copied {len(swift_files)} Swift files into {zappa_root}")


def require(path: Path) -> None:
    if not path.exists():
        raise SystemExit(f"missing required path: {path}")


def patch_browser_view_controller(path: Path) -> None:
    text = path.read_text()
    needle = "        setupEssentialUI()\n        subscribeToRedux()\n"
    replacement = "        setupEssentialUI()\n        installZappaRewriteButton()\n        subscribeToRedux()\n"
    if "installZappaRewriteButton()" not in text:
        if needle not in text:
            raise SystemExit("could not find BrowserViewController.viewDidLoad setup hook")
        text = text.replace(needle, replacement, 1)

    layout_needle = "        super.viewDidLayoutSubviews()\n\n"
    layout_replacement = "        super.viewDidLayoutSubviews()\n        raiseZappaRewriteButton()\n\n"
    if "raiseZappaRewriteButton()" not in text:
        if layout_needle not in text:
            raise SystemExit("could not find BrowserViewController.viewDidLayoutSubviews hook")
        text = text.replace(layout_needle, layout_replacement, 1)

    path.write_text(text)


def patch_project(project_path: Path, swift_files: list[Path], firefox_root: Path) -> None:
    text = project_path.read_text()
    entries = []
    for file_path in swift_files:
        rel = file_path.relative_to(firefox_root).as_posix()
        name = file_path.name
        file_id = stable_id(f"file:{rel}")
        build_id = stable_id(f"build:{rel}")
        entries.append((file_id, build_id, rel, name))

    for file_id, build_id, _rel, name in entries:
        line = (
            f"\t\t{build_id} /* {name} in Sources */ = "
            f"{{isa = PBXBuildFile; fileRef = {file_id} /* {name} */; }};"
        )
        text = upsert_pbx_object(text, build_id, line, "/* End PBXBuildFile section */")

    for file_id, _build_id, rel, name in entries:
        line = (
            f"\t\t{file_id} /* {name} */ = "
            "{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; "
            f"name = {pbx_quote(name)}; path = {pbx_quote(rel)}; sourceTree = SOURCE_ROOT; }};"
        )
        text = upsert_pbx_object(text, file_id, line, "/* End PBXFileReference section */")

    group_id = stable_id("group:Client/Frontend/Zappa")
    if not has_pbx_object(text, group_id):
        children = "\n".join(
            f"\t\t\t\t{file_id} /* {name} */,"
            for file_id, _build_id, _rel, name in entries
        )
        group = (
            f"\t\t{group_id} /* Zappa */ = {{\n"
            "\t\t\tisa = PBXGroup;\n"
            "\t\t\tchildren = (\n"
            f"{children}\n"
            "\t\t\t);\n"
            "\t\t\tpath = Frontend/Zappa;\n"
            "\t\t\tsourceTree = \"<group>\";\n"
            "\t\t};\n"
        )
        text = text.replace("/* End PBXGroup section */", group + "/* End PBXGroup section */", 1)
        client_group_needle = "\t\t\t\tF84B21F11A0910F600AAB793 /* Frontend */,\n"
        text = text.replace(
            client_group_needle,
            client_group_needle + f"\t\t\t\t{group_id} /* Zappa */,\n",
            1,
        )

    missing_build_ids = [build_id for _file_id, build_id, _rel, _name in entries if build_id not in source_phase(text)]
    if missing_build_ids:
        source_section = source_phase(text)
        insert = "".join(
            f"\t\t\t\t{build_id} /* {name} in Sources */,\n"
            for _file_id, build_id, _rel, name in entries
            if build_id in missing_build_ids
        )
        patched_source_section = source_section.replace("			files = (\n", "			files = (\n" + insert, 1)
        text = text.replace(source_section, patched_source_section, 1)

    project_path.write_text(text)


def source_phase(project_text: str) -> str:
    marker = "\t\tF84B21BA1A090F8100AAB793 /* Sources */ = {"
    start = project_text.find(marker)
    if start == -1:
        raise SystemExit("could not find Client sources build phase")
    end = project_text.find("\n\t\t};", start)
    if end == -1:
        raise SystemExit("could not find end of Client sources build phase")
    return project_text[start : end + len("\n\t\t};")]


def has_pbx_object(project_text: str, object_id: str) -> bool:
    return f"\n\t\t{object_id} " in project_text


def upsert_pbx_object(project_text: str, object_id: str, line: str, end_marker: str) -> str:
    pattern = re.compile(rf"\n\t\t{re.escape(object_id)} /\* [^*]+ \*/ = \{{[^\n]*\}};")
    if pattern.search(project_text):
        return pattern.sub("\n" + line, project_text, count=1)
    return project_text.replace(end_marker, line + "\n" + end_marker, 1)


def pbx_quote(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def stable_id(value: str) -> str:
    return hashlib.sha1(("zappa:" + value).encode()).hexdigest()[:24].upper()


if __name__ == "__main__":
    main()
