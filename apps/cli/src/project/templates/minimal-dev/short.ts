import { composition, transition } from "liosvideo";
import intro from "./scenes/intro";
import main from "./scenes/main";
import outro from "./scenes/outro";
import { theme } from "./theme";

export default composition({
  width: 1080,
  height: 1920,
  fps: 30,
  background: theme.colors.bg,
  scenes: [intro, main, outro],
  transitions: [
    transition("slide", { duration: 0.45, direction: "up" }),
    transition("fade", { duration: 0.4 })
  ]
});
