// The style lab reel, 9:16 (Shorts / Reels / TikTok): a title card, then every style's demo in catalog order.
import { composition } from "liosvideo";
import { reel } from "./scenes/reel";

export default composition({ width: 1080, height: 1920, fps: 30, background: "#000000", scenes: reel });
