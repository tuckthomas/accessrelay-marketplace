# Shot meter color conversion replay

The Windows verifier compares CPU and D3D12 color conversion on the same H.264
gameplay frames. Both paths decode on D3D12 and give the NBA meter a complete BGRA
image. The command runs locally with the installed Studio runtime and NBA OCR models.

## Windows measurements on November 18, 2026

On a GeForce RTX 2070 with driver 610.88, GPU conversion delivered the image to
the meter **5.91–5.97 ms sooner** across three NBA practice clips. The saved scene
images were 1280 × 720. Each clip was enlarged to 2560 × 1440 and encoded once
to match the dimensions of the saved Direct Xbox calibration. All six replays
of each clip started with the same five saved meter sweeps.

| Clip | Unique frames | CPU median / p95 | GPU median / p95 | Median gain on matched frames |
| --- | ---: | ---: | ---: | ---: |
| A | 519 | 10.17 / 10.96 ms | 4.22 / 4.66 ms | 5.97 ms |
| B | 496 | 10.14 / 10.88 ms | 4.23 / 4.61 ms | 5.91 ms |
| C | 598 | 10.19 / 11.01 ms | 4.24 / 4.72 ms | 5.96 ms |

Of 4,839 frame deliveries per path, the CPU path delivered 4,838 and the GPU
path delivered 4,837. The paired statistics cover 4,568 matched deliveries after
warm-up. Full-resolution preview and decompressed diagnostic recording matched
the source bytes on both paths in each clip. The OCR model received all
14,745,600 bytes per test frame and found 5–6 text regions on each path.
A control run at clip B's stored 1280 × 720 resolution measured 2.64 ms CPU
and 1.48 ms GPU at the median, with a 1.18 ms gain on matched frames.

### P4 upstrokes on the gameplay footage

The captures contain six manual rhythm shots. The P4 replays use the recorded
stick gestures to define each hold. Times below are milliseconds from the start
of that hold to the first submitted full-up. Ranges cover three runs per path.

| Shot | CPU full-up | GPU full-up | GPU result relative to CPU |
| --- | ---: | ---: | --- |
| A1 | 583.1 | 585.1 | 2 ms later |
| A2 | Missed | 591.6 | Fired on GPU in all three runs. CPU crossed the release deadline. |
| B1 | 586.1 | 584.1–586.1 | Same time twice, 2 ms earlier once |
| B2 | Missed | Missed | CPU ran out of time to start the stroke. GPU reached paddle release without firing. |
| B3 | 676.0 | 676.0 | Same time. On both paths the paddle was released during the final hold. |
| C1 | 664.5 | 660.5 | 4 ms earlier |

The GPU path sent full-up on five of the six shots. Four received a completed
stroke receipt. The CPU path sent full-up on four shots and three received a
completed receipt. B3 accounts for the difference between firing and completing
on each path. Every stroke that reached full-up crossed its own calibrated anchor
within 1.92 ms of schedule, inside the configured 5 ms tolerance.

### Six physical P4 attempts

A separate session had physical P4 inputs, visual predictions and controller
receipts for six shots. Matched gameplay images were unavailable for those
attempts. Replaying the recorded predictions at their original times and about
5.96 ms earlier produced six full upstrokes in both cases. The player reported
five Excellent game grades and one Early on the fifth shot. The fifth full-up occurred at the same
time in both timing replays. Testing how GPU color conversion changes an actual
game grade requires the corresponding pixels and a live console outcome.

The [numeric results for every pass](benchmarks/2026-11-18-meter-color.json)
include the controller receipts, timing references, frame drops and full-frame checks.

## Reproduce the measurement

From the Marketplace checkout, with the Studio source checkout beside it, run

~~~powershell
python tools/replay_meter_color.py $recording $report --studio-runtime $studioRun --models packages/nba2k27/2.1.6/capture-models --profiles $shotProfiles
~~~

Pass a finalized Studio diagnostic directory as the recording, a JSON output file
as the report, and the installed NBA shot profile directory as the source of saved
sweeps. The verifier copies the sweeps into a temporary directory for each replay.
It requires FFmpeg on PATH and the Windows GStreamer runtime used by Direct Xbox.
The temporary encoded clip and diagnostic test images are removed after the run.

The verifier encodes the retained images once at 60 fps and alternates three passes
through each conversion path. Each measurement begins at decoder output and ends
when Studio's frame buffer gives a consumer the full image. Presentation timestamps
identify the same image across passes. The report counts missing deliveries and
excludes the first 30 images from latency statistics.

A separate, unpaced decode feeds the actual meter predictor. It uses the original
capture times, the measured availability of each image, and the time spent inside
the predictor. The native controller scheduler polls every 2 ms in memory. A frame
that missed delivery in a timed pass also misses that replay. A busy meter can
replace a pending frame with a newer one. Each pass starts with its own predictor
and calibration snapshot. The reported full-up time is the first submitted stick
endpoint. The timing anchor is the calibrated fraction of the stroke.

For an older training take, the tool reads the scene at its stored resolution.
When that take contains manual stick shots, the replay substitutes a P4 hold from
the recorded down transition through the return from full-up. The report labels
this input and gives the signed difference from the player's manual full-up time.
Use `--scale 2 --selected-calibration --profiles $shotProfiles --settings-from $attempt`
to compare a 720p scene at a saved 1440p calibration. The calibration must match
the selected profile, timing settings and replay dimensions.

For each conversion, one decoded image also goes through Studio's Direct Xbox
vision session. The test compares every byte in the preview, the image supplied to
the OCR model, and the decompressed diagnostic recording with that path's full
source image. OCR runs outside the latency measurement.
