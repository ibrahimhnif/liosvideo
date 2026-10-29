use indicatif::{ProgressBar, ProgressStyle};

/// Terminal progress bar for video rendering using `indicatif`.
///
/// Displays rendered frames / total frames, elapsed time, ETA, render FPS,
/// and the currently active scene ID.
pub struct RenderProgressBar {
    bar: ProgressBar,
    quiet: bool,
}

impl RenderProgressBar {
    /// Create a new progress bar. If `quiet` is true, the bar is hidden.
    pub fn new(total_frames: u64, quiet: bool) -> Self {
        if quiet {
            return Self {
                bar: ProgressBar::hidden(),
                quiet: true,
            };
        }

        let bar = ProgressBar::new(total_frames);
        let style = ProgressStyle::default_bar()
            .template("{prefix:.bold.cyan} [{elapsed_precise}] [{bar:30.cyan/blue}] {pos}/{len} frames ({percent}%) [{per_sec}, ETA: {eta}] | Scene: {msg}")
            .unwrap_or_else(|_| ProgressStyle::default_bar())
            .progress_chars("██░");

        bar.set_style(style);
        bar.set_prefix("Render");
        bar.set_message("init");

        Self { bar, quiet: false }
    }

    /// Update the current scene identifier displayed on the progress bar.
    pub fn set_scene(&self, scene_id: &str) {
        if !self.quiet {
            self.bar.set_message(scene_id.to_string());
        }
    }

    /// Increment completed frames by 1.
    pub fn inc(&self) {
        self.bar.inc(1);
    }

    /// Advance by `delta` frames.
    pub fn inc_by(&self, delta: u64) {
        self.bar.inc(delta);
    }

    /// Finish progress bar display with a closing message.
    pub fn finish_with_message(&self, msg: &str) {
        if !self.quiet {
            self.bar.finish_with_message(msg.to_string());
        } else {
            self.bar.finish();
        }
    }

    /// Print a message above the progress bar without disturbing it.
    pub fn println(&self, msg: impl AsRef<str>) {
        if !self.quiet {
            self.bar.println(msg.as_ref());
        }
    }

    /// Returns whether the progress bar is in quiet mode.
    pub fn is_quiet(&self) -> bool {
        self.quiet
    }

    /// Returns the current completed frame count.
    pub fn position(&self) -> u64 {
        self.bar.position()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_progress_bar_lifecycle() {
        let pb = RenderProgressBar::new(100, false);
        assert!(!pb.is_quiet());
        pb.set_scene("intro");
        pb.inc();
        assert_eq!(pb.position(), 1);
        pb.inc_by(9);
        assert_eq!(pb.position(), 10);
        pb.finish_with_message("Done");
    }

    #[test]
    fn test_progress_bar_quiet_mode() {
        let pb = RenderProgressBar::new(50, true);
        assert!(pb.is_quiet());
        pb.set_scene("scene-1");
        pb.inc();
        assert_eq!(pb.position(), 1);
        pb.finish_with_message("Done");
    }
}
