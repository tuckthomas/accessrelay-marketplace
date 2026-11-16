# NBA 2K27 Shot Trainer 2.0.1

Replaces the Marketplace's fixed Rhythm Script listing. Requires Studio beta.42+
for the generic recorded-input trainer. This controller package is independent of
the NBA assistance/model-training implementation. Previous packages and controller
profiles remain available; no existing mapping or practice baseline is migrated.

In Controller → Plugins choose **NBA 2K27 Shot Trainer** and create its controller
profile. The profile starts empty with scripts off. Each of **Standing Still**,
**Off-Dribble**, and **Fade-Away** has its own workflow:

1. Select the actual shot input: right stick or a face button. Record one complete
   physical shot-input attempt. Only the selected right stick or face button is
   recorded and replayed; movement, triggers and other buttons stay manual.
   Move into dribbles/fades manually. Reserve the shot input for one attempt; return it to neutral before
   stopping. The recorder waits for physical movement and captures up to 15 seconds.
2. Enter the game's baseline Shot Timing and Shot Tempo feedback, then convert to
   Lua. Conversion reproduces the recorded values/timestamps without correction.
3. Assign the Lua to a controller button, trigger, stick click, D-pad input or
   available Elite paddle. Inputs already mapped to another script are unavailable.
   Assignment does not start output. Start controller and enable Run scripts to try it.
4. After another attempt, choose Shot Timing and Shot Tempo and apply the displayed
   correction. Or drag the hold/stroke sliders and type exact whole milliseconds.
   Saving updates this shot's Lua and keeps Run scripts in its current state.

Timing corrections match the existing NBA controller feedback convention:
Early +16 ms, Slightly Early +8 ms, Slightly Late −8 ms, Late −16 ms.
Tempo corrections change measured down-to-up stroke duration:
Fast +8 ms, Slightly Fast +4 ms, Slightly Slow −4 ms, Slow −8 ms.
Excellent and missing feedback apply no correction. Button shots and simple stick
releases have no measured stroke, so tempo adjustment is unavailable. A stroke
needs intermediate physical movement samples; the trainer does not invent them.

The original baseline and feedback remain saved with the Lua in controller profile
format 7. Edits retime recorded phases, preserving all raw input values and shifting
later samples; they do not claim to infer an animation or guarantee an in-game result.
Each sample retains at least 1 ms. A phase is bounded to 10000 ms and the whole replay
to 15000 ms. Invalid/incomplete/multiple-shot captures and out-of-range edits fail
without replacing the saved script. Re-recording keeps the old script until conversion
succeeds. Custom Lua edits block trainer retuning until a new baseline is recorded.

The package contains declarative shot instructions and feedback adjustments, with no
fixed Lua, model, native runtime or automatic bindings. Studio supplies the shared
recorder, controls, phase retiming, Lua generation, persistence and output engine.
Opening the trainer starts nothing. Player/animation/settings changes may require
another baseline. Live controller and game behavior still require practice testing.

After changing the source manifest, build a new immutable package version with:

```powershell
python tools/package_controller_trainer.py
python tools/validate.py
```

Version 2.0.1 requires Studio beta.42. Playback trims idle lead-in and tail time, sends explicit neutral release, and completes from one brief paddle tap. Tuning and assignment preserve Run scripts; recording still pauses it intentionally. Old unedited generated scripts are repaired from their saved baseline on startup with tuning and mappings retained and the old profile backed up.
