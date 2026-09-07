from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from PIL import Image


SERVICE_ROOT = Path(__file__).resolve().parent
DEFAULT_WORKSPACE = Path(os.environ.get("MASTERMIND_BRITTANY_HTR_ROOT", SERVICE_ROOT / "workspace")).resolve()


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=True))


def executable(name: str) -> Path:
    suffix = ".exe" if os.name == "nt" else ""
    candidate = Path(sys.executable).with_name(f"{name}{suffix}")
    if candidate.is_file():
        return candidate
    located = shutil.which(name)
    if located:
        return Path(located)
    raise RuntimeError(f"{name} is not installed in the Brittany HTR environment")


def run_checked(command: list[str]) -> subprocess.CompletedProcess[str]:
    environment = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    return subprocess.run(command, text=True, capture_output=True, check=True, encoding="utf-8", errors="replace", env=environment)


def command_health(_: argparse.Namespace) -> None:
    import kraken
    import torch

    model_dir = DEFAULT_WORKSPACE / "models"
    models = sorted(str(item.resolve()) for item in model_dir.glob("*") if item.suffix in {".safetensors", ".mlmodel"}) if model_dir.exists() else []
    emit({
        "ok": True,
        "engine": "kraken",
        "engineVersion": getattr(kraken, "__version__", None) or importlib.metadata.version("kraken"),
        "pythonVersion": sys.version.split()[0],
        "cudaAvailable": bool(torch.cuda.is_available()),
        "cudaDevice": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "models": models,
        "workspace": str(DEFAULT_WORKSPACE),
    })


def points_bbox(points: str) -> dict[str, int] | None:
    parsed: list[tuple[int, int]] = []
    for pair in points.split():
        try:
            x, y = pair.split(",", 1)
            parsed.append((round(float(x)), round(float(y))))
        except (TypeError, ValueError):
            continue
    if not parsed:
        return None
    xs, ys = zip(*parsed)
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    return {"x": max(0, x0), "y": max(0, y0), "width": max(1, x1 - x0), "height": max(1, y1 - y0)}


def page_lines(xml_path: Path) -> list[dict[str, Any]]:
    root = ET.parse(xml_path).getroot()
    lines: list[dict[str, Any]] = []
    for index, line in enumerate(root.findall(".//{*}TextLine")):
        coords = line.find("./{*}Coords")
        bbox = points_bbox(coords.attrib.get("points", "")) if coords is not None else None
        if not bbox:
            continue
        baseline_node = line.find("./{*}Baseline")
        equiv = line.find("./{*}TextEquiv")
        unicode_node = equiv.find("./{*}Unicode") if equiv is not None else None
        text = unicode_node.text if unicode_node is not None and unicode_node.text else None
        confidence = None
        if equiv is not None and equiv.attrib.get("conf") is not None:
            try:
                confidence = max(0.0, min(1.0, float(equiv.attrib["conf"])))
            except ValueError:
                confidence = None
        lines.append({
            "lineIndex": index,
            "lineId": line.attrib.get("id", f"line-{index}"),
            "bbox": bbox,
            "baseline": baseline_node.attrib.get("points") if baseline_node is not None else None,
            "text": text,
            "confidence": confidence,
        })
    return lines


def valid_page_xml(xml_path: Path) -> bool:
    """Return false for Kraken's occasional empty/truncated PAGE output."""
    try:
        return xml_path.is_file() and xml_path.stat().st_size > 0 and ET.parse(xml_path).getroot() is not None
    except (OSError, ET.ParseError):
        return False


def kraken_pipeline(image: Path, output: Path, model: Path | None, baseline: bool = True, binarize: bool = False) -> list[str]:
    device = "cuda:0" if os.environ.get("MASTERMIND_HTR_FORCE_CPU") != "1" else "cpu"
    command = [str(executable("kraken")), "-i", str(image), str(output), "-x", "--device", device]
    if device.startswith("cuda"):
        command.extend(["--precision", "bf16-mixed"])
    if binarize:
        command.append("binarize")
    command.extend(["segment", "-bl" if baseline else "-x"])
    if model is not None:
        command.extend(["ocr", "-m", str(model), "-B", "16", "--num-line-workers", "0"])
    return command


def command_page(args: argparse.Namespace) -> None:
    image = Path(args.image).resolve(strict=True) if args.image else None
    segmentation = Path(args.segmentation).resolve(strict=True) if args.segmentation else None
    if image is None and segmentation is None:
        raise ValueError("Either --image or --segmentation is required")
    model = Path(args.model).resolve(strict=True) if args.model else None
    if segmentation is not None and model is None:
        raise ValueError("--segmentation requires --model")
    source_stem = (image or segmentation).stem
    output = Path(args.output).resolve() if args.output else DEFAULT_WORKSPACE / "pages" / f"{source_stem}.xml"
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()
    if segmentation is not None:
        command = [str(executable("kraken")), "-f", "page", "-i", str(segmentation), str(output), "-x", "--device", "cpu", "ocr", "-m", str(model), "-B", "8", "--num-line-workers", "0"]
    else:
        command = kraken_pipeline(image, output, model)
    try:
        result = run_checked(command)
    except subprocess.CalledProcessError as error:
        emit({"ok": False, "error": (error.stderr or error.stdout or str(error))[-4000:], "command": command})
        raise SystemExit(1) from error
    # On some damaged pages Kraken's PAGE-to-PAGE recognition command exits 0
    # but leaves a zero-byte output. Retry those from the original image through
    # the combined segmentation + recognition pipeline before declaring failure.
    if not valid_page_xml(output) and segmentation is not None and image is not None and model is not None:
        if output.exists():
            output.unlink()
        fallback_command = kraken_pipeline(image, output, model)
        try:
            fallback_result = run_checked(fallback_command)
            result = subprocess.CompletedProcess(
                fallback_command,
                fallback_result.returncode,
                fallback_result.stdout,
                "PAGE recognition output was empty; direct image fallback used.\n" + (fallback_result.stderr or ""),
            )
        except subprocess.CalledProcessError as error:
            emit({"ok": False, "error": (error.stderr or error.stdout or str(error))[-4000:], "command": fallback_command})
            raise SystemExit(1) from error
    if not valid_page_xml(output):
        raise RuntimeError("Kraken produced an empty or invalid PAGE XML file")
    lines = page_lines(output)
    confidences = [item["confidence"] for item in lines if item["confidence"] is not None]
    emit({
        "ok": True,
        "mode": "recognize" if model else "segment",
        "output": str(output),
        "lineCount": len(lines),
        "meanConfidence": sum(confidences) / len(confidences) if confidences else None,
        "literalText": "\n".join(item["text"] or "" for item in lines).strip() or None,
        "lines": lines,
        "log": (result.stderr or result.stdout or "")[-2000:],
    })


def offset_line(line: dict[str, Any], x_offset: int) -> dict[str, Any]:
    shifted = {**line, "bbox": {**line["bbox"], "x": line["bbox"]["x"] + x_offset}}
    baseline = line.get("baseline")
    if baseline:
        points: list[str] = []
        for pair in baseline.split():
            try:
                x, y = pair.split(",", 1)
                points.append(f"{round(float(x)) + x_offset},{round(float(y))}")
            except (TypeError, ValueError):
                points.append(pair)
        shifted["baseline"] = " ".join(points)
    return shifted


def command_page_halves(args: argparse.Namespace) -> None:
    """Recognize a difficult spread as two independent leaves.

    Kraken can fail to segment heavily damaged two-page spreads even when each
    leaf is readable. The overlap keeps writing near the gutter intact; results
    are assigned by their global centre point so the overlap is not duplicated.
    """
    image = Path(args.image).resolve(strict=True)
    model = Path(args.model).resolve(strict=True)
    debug_dir = Path(args.debug_dir).resolve() if args.debug_dir else None
    if debug_dir:
        debug_dir.mkdir(parents=True, exist_ok=True)
    overlap_ratio = max(0.0, min(0.12, float(args.overlap)))
    with Image.open(image) as source:
        width, height = source.size
        midpoint = width // 2
        overlap = max(8, round(width * overlap_ratio))
        crops = [
            ("left", 0, min(width, midpoint + overlap)),
            ("right", max(0, midpoint - overlap), width),
        ]
        with tempfile.TemporaryDirectory(prefix="mastermind-htr-halves-") as temporary:
            temporary_path = Path(temporary)
            combined: list[dict[str, Any]] = []
            logs: list[str] = []
            failures: list[str] = []
            for side, x0, x1 in crops:
                crop_path = temporary_path / f"{side}.png"
                xml_path = temporary_path / f"{side}.xml"
                source.crop((x0, 0, x1, height)).save(crop_path, format="PNG")
                recognized_lines: list[dict[str, Any]] = []
                result: subprocess.CompletedProcess[str] | None = None
                errors: list[str] = []
                detector = "baseline"
                for detector, baseline, binarize in (
                    ("baseline", True, False),
                    ("baseline-binarized", True, True),
                    ("legacy-binarized", False, True),
                ):
                    if xml_path.exists():
                        xml_path.unlink()
                    command = kraken_pipeline(crop_path, xml_path, model, baseline=baseline, binarize=binarize)
                    try:
                        result = run_checked(command)
                    except subprocess.CalledProcessError as error:
                        errors.append(f"{detector}: {(error.stderr or error.stdout or str(error))[-700:]}")
                        continue
                    if valid_page_xml(xml_path):
                        recognized_lines = page_lines(xml_path)
                        if debug_dir:
                            shutil.copy2(xml_path, debug_dir / f"{image.stem}-{side}-{detector}.xml")
                    if recognized_lines:
                        break
                    diagnostic = (result.stderr or result.stdout or "").strip().replace("\n", " ")[-700:]
                    errors.append(f"{detector}: no recognized lines{f' ({diagnostic})' if diagnostic else ''}")
                if not recognized_lines:
                    failures.append(f"{side}: " + " | ".join(errors))
                    continue
                logs.append(f"{side}/{detector}: {(result.stderr or result.stdout or '')[-1000:]}")
                for line in recognized_lines:
                    shifted = offset_line(line, x0)
                    shifted["lineId"] = f"{side}-{shifted['lineId']}"
                    combined.append(shifted)
    if not combined:
        raise RuntimeError("Split-page recognition produced no lines: " + " | ".join(failures))
    combined.sort(key=lambda item: (item["bbox"]["y"], item["bbox"]["x"]))
    for index, line in enumerate(combined):
        line["lineIndex"] = index
    confidences = [item["confidence"] for item in combined if item["confidence"] is not None]
    emit({
        "ok": True,
        "mode": "recognize-halves",
        "lineCount": len(combined),
        "meanConfidence": sum(confidences) / len(confidences) if confidences else None,
        "literalText": "\n".join(item["text"] or "" for item in combined).strip() or None,
        "lines": combined,
        "failures": failures,
        "log": "\n".join(logs)[-2000:],
    })


def stable_split(page_id: str) -> str:
    bucket = int(hashlib.sha256(page_id.encode("utf-8")).hexdigest()[:8], 16) % 100
    return "test" if bucket < 5 else "validation" if bucket < 15 else "train"


def command_dataset(args: argparse.Namespace) -> None:
    manifest = Path(args.manifest).resolve(strict=True)
    destination = Path(args.output).resolve()
    lines_dir = destination / "lines"
    lines_dir.mkdir(parents=True, exist_ok=True)
    manifests: dict[str, list[str]] = {"train": [], "validation": [], "test": []}
    accepted = 0
    with manifest.open("r", encoding="utf-8") as source:
        for source_index, raw in enumerate(source):
            if not raw.strip():
                continue
            item = json.loads(raw)
            text = str(item.get("text", "")).strip()
            bbox = item.get("bbox") or {}
            if not text:
                continue
            image_path = Path(item["image"]).resolve(strict=True)
            with Image.open(image_path) as image:
                x = max(0, int(bbox["x"]))
                y = max(0, int(bbox["y"]))
                right = min(image.width, x + int(bbox["width"]))
                bottom = min(image.height, y + int(bbox["height"]))
                if right <= x or bottom <= y:
                    continue
                pad_x, pad_y = max(4, (right - x) // 100), max(3, (bottom - y) // 8)
                crop = image.convert("L").crop((max(0, x - pad_x), max(0, y - pad_y), min(image.width, right + pad_x), min(image.height, bottom + pad_y)))
                identity = str(item.get("id", source_index))
                stem = f"line-{identity}"
                image_out = lines_dir / f"{stem}.png"
                crop.save(image_out, format="PNG", optimize=True)
                (lines_dir / f"{stem}.gt.txt").write_text(text, encoding="utf-8")
                split = str(item.get("split") or stable_split(str(item.get("pageId", identity))))
                if split not in manifests:
                    split = "train"
                manifests[split].append(str(image_out))
                accepted += 1
    for split, paths in manifests.items():
        (destination / f"{split}.lst").write_text("\n".join(paths) + ("\n" if paths else ""), encoding="utf-8")
    emit({"ok": True, "accepted": accepted, "splits": {key: len(value) for key, value in manifests.items()}, "output": str(destination)})


def command_train(args: argparse.Namespace) -> None:
    dataset = Path(args.dataset).resolve(strict=True)
    train = dataset / "train.lst"
    validation = dataset / "validation.lst"
    if not train.is_file() or len(train.read_text(encoding="utf-8").splitlines()) < 20:
        raise RuntimeError("At least 20 corrected training lines are required")
    if not validation.is_file() or len(validation.read_text(encoding="utf-8").splitlines()) < 5:
        raise RuntimeError("At least 5 corrected validation lines are required")
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    device = "cpu" if args.cpu else "cuda:0"
    command = [str(executable("ketos")), "--device", device]
    if device.startswith("cuda"):
        command.extend(["--precision", "bf16-mixed"])
    command.extend(["train", "--arch", "ppocrv6", "--variant", "small", "--resize", "union", "-f", "path", "-t", str(train), "-e", str(validation), "-o", str(output)])
    if args.base_model:
        command.extend(["--load", str(Path(args.base_model).resolve(strict=True))])
    completed = subprocess.run(command, text=True, encoding="utf-8", errors="replace", env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"})
    raise SystemExit(completed.returncode)


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Mastermind Brittany HTR local engine")
    commands = root.add_subparsers(dest="command", required=True)
    health = commands.add_parser("health")
    health.set_defaults(handler=command_health)
    page = commands.add_parser("page")
    page.add_argument("--image")
    page.add_argument("--segmentation")
    page.add_argument("--output")
    page.add_argument("--model")
    page.set_defaults(handler=command_page)
    page_halves = commands.add_parser("page-halves")
    page_halves.add_argument("--image", required=True)
    page_halves.add_argument("--model", required=True)
    page_halves.add_argument("--overlap", default="0.025")
    page_halves.add_argument("--debug-dir")
    page_halves.set_defaults(handler=command_page_halves)
    dataset = commands.add_parser("dataset")
    dataset.add_argument("--manifest", required=True)
    dataset.add_argument("--output", required=True)
    dataset.set_defaults(handler=command_dataset)
    train = commands.add_parser("train")
    train.add_argument("--dataset", required=True)
    train.add_argument("--output", required=True)
    train.add_argument("--base-model")
    train.add_argument("--cpu", action="store_true")
    train.set_defaults(handler=command_train)
    return root


def main() -> None:
    args = parser().parse_args()
    try:
        args.handler(args)
    except Exception as error:
        emit({"ok": False, "error": str(error), "type": type(error).__name__})
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
