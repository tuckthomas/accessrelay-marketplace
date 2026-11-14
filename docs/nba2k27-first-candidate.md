# First real-footage Push-phase candidate — 2026-11-14

An actual ONNX candidate was trained on the user's NBA 2K27 build 2.0.0.12
recordings with PyTorch 2.10.0+cu128 on the RTX 2070. This is a small,
observation-only animation-cue pilot. It is not approved for automatic release.

Three meter-on shot intervals from two sessions, plus two non-shot intervals,
produced 37 overlapping training windows (23 positive). A separate meter-off
session supplied one shot and one non-shot interval, producing 23 validation
windows (7 positive). A different meter-off configuration-reference session was
excluded from training and evaluation. There is no untouched held-out set.

Frame-by-frame visual review marked the transition from set point into forward
Push extension. Labels have an explicit 40 ms annotation allowance and are
provisional; the hidden green-window center was not established. Controller-up
timestamps, ball departure and delayed shot results were not used as target labels.
Meter/feedback pixels and controller traces are not model inputs.

The existing geometric preparation had admitted some crops visibly containing
part of the shot meter. Those frames were excluded. Conversion v2 selects only
reviewed interval frames while preserving complete original source files and
hash-bound proof. The loader also rejects windows extending before an interval;
unreviewed neighboring frames cannot become temporal history. No pixels were
masked, interpolated or relabelled as independent footage.

The native-compatible baseline uses 4 RGB frames at nominal 16.67 ms spacing,
160×160 input, an ordered temporal-convolution head and 15,005 parameters. Clean
coverage did not support the default 750 ms history. Both recorded histories and
the short baseline's limits remain explicit. Training ran for 80 epochs. A first
run produced 94.28 ms validation MAE; a diagnostic adjustment using a training-only
initial timing prior, a 200 ms loss scale and a 40 ms uncertainty floor produced:

| Measurement | Result |
| --- | ---: |
| Timing MAE against provisional validation labels | 56.53 ms |
| Descriptive timing p95 | 98.04 ms |
| Predictions accepted under existing release limits | 0 |
| Native C# CPU inference median / p95 | 1.223 / 1.478 ms |
| Native C# CUDA inference median / p95 | 0.547 / 0.685 ms |

Inference timings used the same actual preprocessed recorded window, 10 warmups
and 100 repetitions, with reusable tensors and host transfers. They exclude
capture, pose/OCR, preprocessing, Remote Play transport and controller delivery.
CPU/CUDA observations differed by approximately 0.00011 at most in the five output values.
Both C# adapters loaded the model with `CanArm=false`.

The timing error is too large for release assistance. Zero accepted predictions
does not establish a low false-release rate. Validation was reused during
diagnostic adjustment; overlapping windows from one shot are not independent
accuracy trials. No green rate, physical latency calibration, held-out accuracy
or robustness under contests, different movements or occlusion is established.

Weights SHA-256: `17f21cbd79d33cca39f8531f10d2f55b7b3282218e7fea4512467816772a2176`.
User recordings, annotations, weights and detailed receipts remain local on M:.
The package retains the native temporal-release-v1/RGB preprocessing contract;
Python is used only for offline training. Training and evaluation completing
successfully describes worker execution, not gameplay acceptance.
