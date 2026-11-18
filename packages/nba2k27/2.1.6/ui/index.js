import { bindHost } from './host.js';
import { Nba2K27VisionWorkspace } from './VisionWorkspace.js';
import { Nba2K27SequenceTuning } from './ControllerTuning.js';
export function createPlugin(host) {
    bindHost(host);
    return { VisionWorkspace: Nba2K27VisionWorkspace, ControllerTuning: Nba2K27SequenceTuning };
}
