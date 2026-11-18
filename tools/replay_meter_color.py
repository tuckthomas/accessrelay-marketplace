"""Compare full-frame color conversion using one local NBA diagnostic or training take."""
import argparse
import gzip
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def p4(value):
    return (value & 8) != 0 if isinstance(value, int) else "largeright" in str(value).lower()


def diagnostic(directory):
    data = read(directory / "diagnostic.json")
    if not data.get("finalized"):
        raise ValueError("The diagnostic is still recording. Stop and finalize it before replay.")
    timeline, images, holds, receipts = [], [], [], {}
    end = None
    for frame in data["frames"]:
        ctx = frame.get("physicalContext") or {}
        receipt = frame.get("lastAttempt")
        if receipt and receipt.get("actualAnchorTimestamp", 0) > 0:
            receipts[receipt["actualAnchorTimestamp"]] = receipt
        now = ctx.get("inputTimestamp") or frame["captureTicks"]
        if p4(ctx.get("heldPaddles")):
            start = ctx.get("holdStartedTimestamp")
            if start and (not holds or start != holds[-1]["start"]):
                if holds and holds[-1]["end"] is None:
                    holds[-1].update(end=end, truncated=True)
                holds.append(dict(start=start, end=None, armed=bool(ctx.get("armed"))))
            elif holds and ctx.get("armed"):
                holds[-1]["armed"] = True
        elif holds and holds[-1]["end"] is None:
            holds[-1]["end"] = now
        end = now
        if frame.get("file"):
            path = directory / frame["file"]
            if path.resolve().parent != directory.resolve() or not path.is_file():
                raise ValueError("A declared diagnostic image is missing or outside the recording.")
            images.append((path, None, frame["stride"] * frame["height"]))
            timeline.append(dict(ticks=frame["captureTicks"], sequence=frame["sequence"], physical=ctx.get("physical"),
                                 inputTicks=ctx.get("inputTimestamp"), fresh=frame.get("sourceFresh"), generation=frame["sourceGeneration"],
                                 direct=(frame.get("streamTelemetry") or {}).get("direct")))
            shape = (frame["width"], frame["height"], frame["stride"])
            if len(images) == 1:
                geometry = shape
            elif geometry != shape:
                raise ValueError("Use a continuous take with a single source geometry.")
    if not images:
        raise ValueError("The diagnostic has no retained images.")
    if holds and holds[-1]["end"] is None:
        holds[-1]["end"] = end
        holds[-1]["truncated"] = True
    for hold in holds:
        for receipt in receipts.values():
            if hold["start"] <= receipt["actualStartedTimestamp"] <= hold["end"]:
                hold["referenceAnchor"] = receipt["anchorTimestamp"]
                break
    context = data["context"]
    return (geometry, images, dict(source="diagnostic-p4", frames=timeline, holds=holds,
            frequency=data["stopwatchFrequency"], settings=context["settings"], profile=context["selection"]["profile"]))


def training(directory):
    data = read(directory / "session.json")
    scene = next(s for s in data["captureEvidence"]["streams"] if s["name"] == "scene")
    geometry = (scene["width"], scene["height"], scene["stride"])
    path = directory / scene["file"]
    if path.resolve().parent != directory.resolve():
        raise ValueError("The scene file must be inside its training take.")
    images, timeline, holds = [], [], []
    for frame in data["frames"]:
        item = next((s for s in frame.get("evidence", []) if s["name"] == "scene"), None)
        if item:
            images.append((path, item["offsetBytes"], item["byteLength"]))
            timeline.append(dict(ticks=frame["captureTicks"], sequence=frame["sequence"], generation=frame["sourceGeneration"]))
    polls = [s for s in read(directory / "controller-trace.json")["samples"] if s["kind"] == "poll"]
    actual = any(p4(s.get("heldPaddles")) for s in polls)
    # For old manual takes use only observed down/up gestures. The substitute P4
    # is held from the down transition until the stick returns from the upstroke.
    # A recorded manual reversal is a comparison clock, never a game timing grade.
    start = up = None
    for sample in polls:
        t = sample["sampleTicks"]
        axis = (sample.get("physical") or {}).get("rightY", 0)
        pressed = p4(sample.get("heldPaddles"))
        if start is None and (pressed if actual else axis <= -23000):
            start = t
        if start is not None:
            if not actual and up is None and axis >= 30000:
                up = t
            if (actual and not pressed) or (not actual and up is not None and axis < 16000):
                holds.append(dict(start=start, end=t, manualUp=up, armed=True))
                start = up = None
            elif not actual and up is None and t - start > data["stopwatchFrequency"] * 1.5:
                start = None
    return (geometry, images, dict(source="training-p4" if actual else "training-stick-as-p4",
            frames=timeline, holds=holds, frequency=data["stopwatchFrequency"], profile=data["shotProfile"]))


def encode(images, geometry, clip, scale):
    width, height, stride = geometry
    if stride < width * 4:
        raise ValueError("Stored row pitch is smaller than the picture.")
    filters = f"scale={width * scale}:{height * scale}:flags=neighbor:out_color_matrix=bt709:out_range=tv,format=yuv420p"
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-f", "rawvideo", "-pixel_format", "bgra",
               "-video_size", f"{width}x{height}", "-framerate", "60", "-i", "pipe:0", "-vf", filters,
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-bf", "0", "-g", "60", "-colorspace", "bt709",
               "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-an", str(clip)]
    with subprocess.Popen(command, stdin=subprocess.PIPE) as encoder:
        try:
            for path, offset, length in images:
                if offset is None:
                    with gzip.open(path, "rb") as image:
                        pixels = image.read(length + 1)
                else:
                    with path.open("rb") as scene:
                        scene.seek(offset)
                        pixels = scene.read(length)
                if len(pixels) != stride * height or length != len(pixels):
                    raise ValueError("A stored frame has incomplete rows.")
                if stride != width * 4:
                    pixels = b"".join(pixels[y*stride:y*stride+width*4] for y in range(height))
                encoder.stdin.write(pixels)
        finally:
            encoder.stdin.close()
        if encoder.wait() != 0:
            raise RuntimeError("Could not encode the paired replay clip.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recording", type=Path)
    parser.add_argument("report", type=Path)
    parser.add_argument("--models", type=Path, required=True, help="The packaged NBA capture-models directory")
    parser.add_argument("--studio-runtime", type=Path, required=True, help="Studio directory containing onnxruntime.dll and RemotePlay/GStreamer")
    parser.add_argument("--profiles", type=Path, help="Saved shot profile directory containing MeterTiming")
    parser.add_argument("--settings-from", type=Path, help="Use the timing settings from an attempt when replaying an older training take")
    parser.add_argument("--selected-calibration", action="store_true", help="Try the saved P4 calibration on a training scene at its calibrated dimensions")
    parser.add_argument("--scale", type=int, choices=(1, 2), default=1, help="Optional nearest-neighbor enlargement for training footage")
    parser.add_argument("--no-build", action="store_true")
    args = parser.parse_args()
    directory = args.recording.resolve()
    is_diagnostic = (directory / "diagnostic.json").is_file()
    if is_diagnostic and args.scale != 1:
        parser.error("A diagnostic must retain its recorded calibration dimensions.")
    geometry, images, timeline = diagnostic(directory) if is_diagnostic else training(directory)
    if args.settings_from and not is_diagnostic:
        timeline["settings"] = read(args.settings_from)["settings"]
    if args.selected_calibration:
        if is_diagnostic or not args.profiles or not args.settings_from:
            parser.error("--selected-calibration requires a training take, --profiles and --settings-from")
        from uuid import UUID
        selected = UUID((args.profiles / "selected-shot-profile.txt").read_text(encoding="utf-8-sig").strip()).hex
        timeline["profile"] = read(args.profiles / (selected + ".json"))["profile"]
        timeline["savedCalibration"] = True
    if len(images) < 32 or any(a["ticks"] >= b["ticks"] for a, b in zip(timeline["frames"], timeline["frames"][1:])):
        raise ValueError("At least 32 chronological recorded images are required.")
    timeline.update(width=geometry[0]*args.scale, height=geometry[1]*args.scale, sourceWidth=geometry[0], sourceHeight=geometry[1])
    with tempfile.TemporaryDirectory(prefix="AccessRelay-meter-color-") as temporary:
        folder = Path(temporary)
        encode(images, geometry, folder / "clip.mkv", args.scale)
        (folder / "timeline.json").write_text(json.dumps(timeline), encoding="utf-8")
        if args.profiles and (args.profiles / "MeterTiming").is_dir():
            # Each pass reads a private snapshot of the saved sweeps.
            shutil.copytree(args.profiles / "MeterTiming", folder / "MeterTiming")
        project = Path(__file__).resolve().parents[1] / "plugins/nba2k27/tests/Windows/PluginWindowsVerification.csproj"
        command = ["dotnet", "run", "--project", str(project), "-c", "Release"]
        if args.no_build:
            command.append("--no-build")
        runtime = args.studio_runtime.resolve()
        env = os.environ.copy()
        bundled = runtime / "RemotePlay" / "GStreamer"
        if bundled.is_dir():
            env["GSTREAMER_1_0_ROOT_MSVC_X86_64"] = str(bundled)
        subprocess.run(command + ["--", "--meter-color-replay", str(folder), str(args.models.resolve()), str(runtime),
                                  str(args.report.resolve())], env=env, check=True)


if __name__ == "__main__":
    main()
