# NBA 2K27 implementation

## Direct meter assistance (1.2.3; Studio beta.33+)

Choose **Shot meter · direct detection** in Live Gameplay or Model Training.
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

The preview and practice panel sit together. Readiness shows whether gameplay is
capturing and controller output is connected; connection errors appear beside the
controls. Start the preview, connect output if needed, then choose **Start practice
trial**. Hold the physical input until the reversal finishes, then return neutral.
The page pauses a trial started there when its new native action receipt arrives.
Opening the page never starts capture, connects output or arms assistance.

After a completed action, select the timing and tempo NBA actually reported and
choose **Save result**. Feedback starts blank. Three matching Excellent results
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
timing and (for rhythm) Excellent tempo, followed by explicit confirmation. The
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
