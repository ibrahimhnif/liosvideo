// UI mockups, 9:16: one scene per component.
import { composition, transition } from "liosvideo";
import browser from "./scenes/browser";
import chat from "./scenes/chat";
import explorer from "./scenes/explorer";
import notification from "./scenes/notification";

export default composition({
  width: 1080,
  height: 1920,
  fps: 30,
  background: "#0b0d12",
  scenes: [browser, explorer, chat, notification],
  transitions: [transition("fade", { duration: 0.4 }), transition("fade", { duration: 0.4 }), transition("fade", { duration: 0.4 })],
});
