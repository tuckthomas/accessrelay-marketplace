# NBA 2K27 implementation

The Marketplace catalog includes NBA 2K27 version 2.1.6. The add-on requires runtime
contract 4, which ships with AccessRelay Studio 1.9.0-beta.49.

For a curved meter in practice, keep the trial running through two stationary shots
with the shot meter visible. Studio measures the bright fill against the gray sides
of the meter. If two meters appear before tracking starts, the add-on keeps looking
for a single meter. It can learn a sweep that first becomes visible partway up,
using the fill positions it sees. When the trial ends, it saves those measurements.
Assistance can use them on the first shot after
a restart with the same profile, capture source, and resolution. Each new shot must
show matching meter movement before Studio schedules the upstroke.

The meter forecast compares linear, logarithmic and quadratic progression models
using causal held-out frames. Uncertainty includes image resolution, forecast
horizon, validation error and disagreement between plausible models. It may withhold
an early forecast when the evidence cannot support the configured timing budget;
a small regression residual alone no longer qualifies a stroke.

Calibration binds both tempo correction and effective stroke duration. Existing
results without that evidence remain readable but require fresh practice confirmation.
Cancelled actions, unvalidated local output timing and observed unstable streaming
cannot supply calibration evidence. The UI shows stream readings and cancellation
reasons, and prevents saving an older completed receipt after a newer cancellation.

Enable the Xbox statistics overlay in the captured window. Studio reads labelled
ping/latency, jitter, decode time and FPS in the background with Windows OCR. Adjust
its normalized crop under **Advanced settings** if necessary. Missing or unstable
readings pause automatic tuning; they never become zero delay or replace calibrated
video/input compensation. A documented API for an external app to query the native
Xbox PC app's stream telemetry was not found. Automatic timing learning also requires
repeated reliable results in the same distance/coverage context. Use separate saved
profiles for different contexts. Tempo changes require practice revalidation.


## Direct meter assistance (1.2.12; Studio beta.38+)

Version 1.2.12 records the game's feedback heading separately from its grades.
An explicitly reported **RHYTHM — EXCELLENT** result counts toward the three-shot
calibration requirement even when the game shows no separate Tempo grade. Its
tempo stays `none`; no Excellent tempo is manufactured. **TIMING — EXCELLENT**
alone never confirms a rhythm shot. When a separate tempo grade is shown, it
must be Excellent to count. Existing separate timing/tempo results remain valid.
Receipt, setup, capture-size and explicit-confirmation checks still apply.

A controlled replay of a captured manual right-stick motion through the virtual
controller produced RHYTHM — EXCELLENT with no physical input detected. A separate
830 ms down hold and 56 ms generated ramp produced TIMING — LATE. The replay
establishes that the virtual path can deliver a recognized rhythm shot; it does
not establish Live detector timing accuracy or resolve competing physical input
during an assisted shot. This release fixes feedback acceptance, not that remaining
Live timing investigation.

Version 1.2.11 restores the Model Training recording/review workspace regardless
of the selected Live assistance method. Opening training never changes timing or
arms output. Live meter assistance also handles a missing settings snapshot
without repeatedly rendering, then adopts settings when they arrive. The full
seven-file UI suite covers both assistance methods, recording, clip review,
profile/label drafts, plugin selection, calibration and feedback compatibility.

Version 1.2.10 restores feedback-driven practice calibration. **Save result** first
stores the completed action against its original settings, then applies the next
trial's settings and restarts the preview with assistance off. Late/Early moves
the timing correction by 8 ms, Slightly late/early by 4 ms. Fast/Slow changes
stroke duration by 4 ms, Slightly fast/slow by 2 ms. Excellent leaves that setting
unchanged; No tempo shown never guesses a stroke adjustment. The save notice
shows the actual changes. Start the next practice trial explicitly.

Saved evidence includes the actual correction and stroke duration. When opposite
feedback brackets a value in the same setup, resolution and other timing value,
subsequent steps shrink toward the midpoint instead of overshooting repeatedly.
Automatic correction stays within -120 to +120 ms (manual values outside that
range can move inward); stroke duration retains its 8–500 ms limits. Reaching a
limit is reported with a request to inspect settings and diagnostics. These are
conservative search limits, not measured game or capture latency. If applying an
adjustment fails, the result stays saved and the next trial is blocked until the
settings are retried or explicitly discarded. Prior results remain attached to
their original setup and cannot count toward a changed calibration. Three matching
Excellent timing/tempo results still require explicit confirmation.

Version 1.2.8 makes **Save result** save feedback without changing timing or
restarting capture. The previous automatic adjustment stacked -80 ms after each
Late/no-tempo result; repeated saves could move the requested stroke start before
the first usable forecast. Timing edits remain explicit in Advanced settings.
Saved results and their original configuration keys are retained. Start each
practice trial explicitly after saving. This change does not establish the cause
of missing in-game tempo feedback or measure end-to-end capture/output latency.

Version 1.2.7 fixes the practice recording flow. A calibration trial pauses after
one completed action, which previously left subsequent recordings with live
detector forecasts but automatic reversal off. The page now always shows the
actual On/Off state and explains the pause. **Record assisted trial** starts the
diagnostic recorder before explicitly arming one shot. If a previous result is
unsaved, **Skip result and record next trial** explicitly skips that feedback;
saved calibration results are kept. A recording or arming failure keeps the
pending feedback available and attempts cleanup. **Record diagnostics** remains
an observation recording using the current assistance state. Accepted assistance
can use **Record assisted shots** and stays on until paused. This update preserves
the detector, timing policy and calibration keys from 1.2.6.

Version 1.2.6 fixes detector/scheduler failures reproduced from the user's retained
1440p diagnostic footage. Green Excellent feedback could match a curved poster
edge and be acquired as a meter; acquisition now requires a flat neutral ribbon
interior across the fitted curve. Nearby cap fragments are grouped using cap size,
scale and overlapping ribbon geometry, while separate meters remain ambiguous.
When compression fragments the target cap, the detector also tests the previous
full ribbon shape against the current pixels instead of shrinking its height
from the smaller cap fragment alone.

Fill is normalized over the actual scanned, fillable span below the colored cap.
Previously the scan stopped near 90% of the fitted shape but the timing target was
100%, producing a false late stall. The host now applies the configured maximum
frame age at stroke start as it does during the stroke; it no longer has an
undocumented 25 ms cutoff. No target-time shortcut, repeated image or saved
forecast is used to bypass freshness or tracking failures.

Device-free replay of all 405 retained images in the full-hold diagnostic produced
three completed native action receipts. The same replay retains missing images
as gaps and sends no controller output. The armed recording's feedback-box false
matches were rejected. These are regression results, not measured Xbox timing or
an Excellent-shot rate. The changed fill scale requires matching practice results;
saved clips and prior calibration receipts are preserved.

Version 1.2.5 anchors hold qualification and acquisition timeouts to the host's
physical input transition, including presses between video frames. One short
missing detection retains the meter identity for at most 70 ms and clears the fit
history. Identity changes, ambiguous meters, expired identity, broken cadence and
loss of tracking after a forecast cancel the attempt until neutral or a verified
new physical press. Armed assistance requires the host's actual hold timestamp.

Saved timing forecasts are never replayed as fresh observations. Only after the
host has actually crossed the stroke's timing anchor may expected meter
disappearance or cap saturation request completion of that same stroke. This is
reported explicitly without a new target estimate; it cannot start or move a
stroke deadline. Ambiguity and identity/progression failures still cancel, even
after the anchor. The scheduler separately validates phase and frame freshness.
Runtime contract 3 requires the matching host; the policy change requires fresh
practice calibration. Existing receipts remain saved.

**Record assisted trial** saves up to 15 seconds and enables the practice shot in
one action. **Record diagnostics** saves alongside the current preview without
changing assistance; when automatic reversal is off it records observations only.
Stop after the failed attempt or let it finish automatically. **Open diagnostic
folder** reveals `diagnostic.json`, the original native-resolution BGRA frames
(individually gzip-compressed), and `review.html`. Open the viewer and choose that
folder to scrub through the images, fill graph, measured velocity, forecast,
uncertainty, frame intervals, controller states and output decisions offline.
Recordings live under the application's `Diagnostics/VisionRecordings` folder.
No training setup, model, calibration receipt or successful reversal is required.

The recorder retains detection details for each processed frame even when its
three-image queue is full. Image skips, copy/queue/write times and capture-pipeline
counters are explicit. Recording adds local overhead; compare cadence with an
unrecorded attempt. The compressed-image limit is 1 GiB plus at most one final
image. Stopping preview finalizes recording. Controller readings accompany video
frames; they do not establish Xbox input receipt or render-to-capture latency.
Rejected fill-velocity readings now retain their measured value in diagnostics.

Choose **Shot meter · direct detection** in Live Gameplay. Model Training opens
the recording, clip-review and offline training workspace.
Select a meter-on shot profile and enable the **Curved** meter in the game.
The CPU detector acquires the colored target cap and curved ribbon across the
gameplay viewport, follows a moving ROI, and measures the bottom-connected white
interior fill. The protruding Pro Stick tick is not used as an animation clock.
Resolution changes scale pixel geometry automatically; no player, gamertag,
pose, court polygon, model file or training dataset is required for this mode.
Other meter styles are not claimed to work with this detector.

Version 1.2.3 fixes fill continuity at higher capture resolutions. The previous
fixed-pixel gap tolerance could split a rising fill after a small compression
break; a real-shot fixture with a two-row dark gap reproduced 76% fill being read
as 47% at 1440p.
The tolerance now scales with capture height. The same fixture retains 76%,
while larger separated bright regions remain disconnected. Geometry score also
remains visible while the predictor is still measuring velocity. Existing
calibration receipts remain saved, but the changed detector policy requires
fresh matching calibration. This is offline regression evidence; live reversal
and game timing still require practice validation.

Physical input passes through immediately. A configurable hold qualifies
acquisition; it is a heuristic, not a guarantee that a movement is a shot.
Acquisition expires if no new meter appears; ambiguous meters, identity jumps,
backward progression and broken cadence invalidate the attempt. Rolling
past/present-only fits report velocity, forecast and uncertainty. Noisy fits
withhold updates; they cannot refresh the host's valid-forecast deadline.

The preview and practice panel sit together. Readiness shows whether automatic
reversal is on, gameplay is capturing and controller output is connected; connection errors appear beside the
controls. Start the preview, connect output if needed, then choose **Start practice
trial**. Hold the physical input until the reversal finishes, then return neutral.
The page pauses a trial started there when its new native action receipt arrives.
Opening the page never starts capture, connects output or arms assistance.

After a completed action, select the timing and tempo NBA actually reported and
choose **Save result** to tune the next practice trial. Feedback starts blank. Three matching Excellent results
enable **Save calibration**. An existing unconfirmed set from another app session
requires a fresh completed action before confirmation.

**Advanced settings** holds game build, latency estimates, timing correction,
stroke duration, timing-anchor fraction, curve, up hold and detector tuning. Apply
valid changes to pause assistance and resume the preview; controller output stays
connected. A negative correction sends earlier, a positive correction later.
For tempo, test stroke durations empirically against the game's Fast/Slow feedback;
the game-specific recognition threshold has not been independently measured.

The timing anchor refers to axis travel, **not** the end of the whole ramp. At a
linear 0.5 anchor, an 80 ms down-to-up stroke starts 40 ms before neutral crossing.
Smooth curves invert the curve when computing that lead. Absolute QPC deadlines
drive the host's existing sole output writer at 2 ms scheduled intervals; this
requests cadence and does not guarantee Windows or Xbox delivery at that cadence.
The ramp is committed at start, not repeatedly warped after motion begins.

Normal assistance needs three native completed-action receipts with Excellent
timing. Rhythm mode also requires an explicit RHYTHM heading when no separate
tempo is shown, or Excellent tempo when a separate grade is reported. Results
still need explicit confirmation. The
page refreshes the preview after confirmation and leaves assistance off until started.
Receipts bind feedback to the actual local action and reject duplicate feedback.
Profile, camera, meter appearance, game build, capture source, resolution and timing
edits require matching results. Confirmation is user-reported practice evidence,
not a statistical accuracy certificate or a measured render-to-Xbox latency.
No calibration is prefilled or automatically enabled by installation.

The under-foot indicator can later provide an optional spatial/movement hint.
Three screen-space deltas mix camera and player motion; they do not reliably
classify a fadeaway or determine its tempo. They must not hard-limit meter search
or prevent acquisition near the viewport edges.

The older **Animation model · meter off** workflow remains available separately.
Its optional pose/OCR weights are still packaged for that workflow and are never
loaded by the direct-meter path. Runtime contract 2 prevents older Studio versions
from loading an implementation requiring the new predictor/action SDK.

This plugin is built as its own .NET assembly and interface module. Studio loads
it from the installed Marketplace package; its game code is not compiled into Studio.

- src/: saved player/shot profiles, camera choices, gamertag/pose association,
  moving player/meter regions, floor estimates, fixed feedback and controller tuning.
- ui/: recording, setup, review and feedback controls, using Studio's React instance,
  shared components and theme. The timeline updates during dragging.
- training/: offline evidence conversion, training, evaluation, audits and experiments.
- notices/: upstream capture-model sources, hashes, licenses and limitations.
- tests/: game-specific profile, tracking, workflow and host-integration checks.

Packages include the runtime, interface, workflows and optional pose/OCR capture weights.
No separate model installer is needed. The acquisition models are not a trained
shot-release model. The controller Rhythm Script remains a separate package.

Studio owns source-window selection, folders, device lifecycle, capture, inference
execution and final output scheduling. Existing per-user NBA profiles, fingerprints,
capture settings and recordings remain compatible. Live processing is C#; Python
is used only for explicit offline jobs. Installing the plugin starts no processing.

Automatic acquisition associates the exact, case-sensitive gamertag with a detected
body/pose, rechecks identity and rejects ambiguity. Player/meter regions move; floor
geometry constrains ground position without masking hands above the sideline.
Feedback is fixed. These proposals still require gameplay review; acquisition pose
is not a shot-type classifier or timing predictor. Retained original scene/input
traces remain the source of truth. Manual calibration is an explicit alternative.

Training requires reviewed independent footage, appropriate meter-on supervision,
a separate meter-off configuration reference, held-out evaluation and physical timing
acceptance. No trained or hardware-accepted NBA release model is claimed by this move.
