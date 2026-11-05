// The style lab reel, 16:9 (YouTube / presentations): a title card, then every style's demo in catalog order.
import { composition } from "liosvideo";
import { reel } from "./scenes/reel";

export default composition({ width: 1920, height: 1080, fps: 30, background: "#000000", scenes: reel });
