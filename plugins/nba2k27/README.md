# NBA 2K27 implementation

This plugin is built as its own .NET assembly and interface module. Studio loads
it from the installed Marketplace package; its game code is not compiled into Studio.

- src/: saved player/shot profiles, camera choices, gamertag/pose association,
  moving player/meter regions, floor estimates, fixed feedback and controller tuning.
- ui/: recording, setup, review and feedback controls, using Studio's React instance,
  shared components and theme. The timeline updates during dragging.
- training/: offline evidence conversion, training, evaluation, audits and experiments.
- notices/: upstream capture-model sources, hashes, licenses and limitations.
- tests/: game-specific profile, tracking, workflow and host-integration checks.

Package 1.1.0 includes the runtime, interface, workflows and pose/OCR capture weights.
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
