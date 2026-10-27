import { probeWorkerScope } from "./capabilities";

probeWorkerScope().then((caps) => self.postMessage(caps));
