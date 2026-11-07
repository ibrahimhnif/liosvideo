//! Master bus: ducking, BS.1770 loudness and a peak limiter.
//! Port of `packages/runtime/src/audio/mix.ts`; keep the constants identical.
//! Audio is interleaved stereo f32.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Duck {
    /// Reduction in dB while voice-over plays.
    pub amount: f64,
    /// Seconds the dip starts before each line.
    pub attack: f64,
    /// Seconds to come back up after a line.
    pub release: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MixSettings {
    /// Integrated loudness target in LUFS; `None` keeps the raw level.
    pub loudness: Option<f64>,
    /// Limiter ceiling in dBFS.
    pub ceiling: f64,
    pub duck: Option<Duck>,
}

const DEFAULT_DUCK: Duck = Duck {
    amount: 12.0,
    attack: 0.15,
    release: 0.4,
};
/// Clips at least this long count as a music bed and duck by default.
pub const BED_MIN_SECONDS: f64 = 8.0;

impl Default for MixSettings {
    fn default() -> Self {
        Self {
            loudness: Some(-14.0),
            ceiling: -1.0,
            duck: Some(DEFAULT_DUCK),
        }
    }
}

impl MixSettings {
    /// Reads a composition's `mix` object (`{ loudness?: number | false, ceiling?, duck?: false | {...} }`).
    pub fn from_json(v: &serde_json::Value) -> Self {
        let mut m = Self::default();
        match v.get("loudness") {
            Some(serde_json::Value::Bool(false)) => m.loudness = None,
            Some(x) if x.is_number() => m.loudness = x.as_f64(),
            _ => {}
        }
        if let Some(c) = v.get("ceiling").and_then(|c| c.as_f64()) {
            m.ceiling = c;
        }
        match v.get("duck") {
            Some(serde_json::Value::Bool(false)) => m.duck = None,
            Some(d) if d.is_object() => {
                let f = |k: &str, dflt: f64| d.get(k).and_then(|x| x.as_f64()).unwrap_or(dflt);
                m.duck = Some(Duck {
                    amount: f("amount", DEFAULT_DUCK.amount),
                    attack: f("attack", DEFAULT_DUCK.attack),
                    release: f("release", DEFAULT_DUCK.release),
                });
            }
            _ => {}
        }
        m
    }
}

/// Gain breakpoints `(seconds, gain)`, linear between points, 1 outside.
pub type DuckPlan = Vec<(f64, f64)>;

pub fn is_voice(src: &str, role: Option<&str>) -> bool {
    role == Some("vo") || src.starts_with("vo/") || src.contains("/vo/")
}

/// A file named `sfx` (or in an `sfx/` folder) is an effects track.
pub fn is_sfx_name(src: &str) -> bool {
    let lower = src.to_ascii_lowercase();
    let sep = |c: Option<char>| c.is_none_or(|c| matches!(c, '/' | '\\' | '.' | '_' | '-'));
    lower
        .match_indices("sfx")
        .any(|(i, _)| sep(lower[..i].chars().next_back()) && sep(lower[i + 3..].chars().next()))
}

/// Whether a clip that plays for `played` seconds should dip under voice-over.
pub fn should_duck(src: &str, role: Option<&str>, ducking: Option<bool>, played: f64) -> bool {
    if is_voice(src, role) {
        return false;
    }
    if ducking == Some(true) || role == Some("music") {
        return true;
    }
    if ducking == Some(false) || role == Some("sfx") || (role.is_none() && is_sfx_name(src)) {
        return false;
    }
    played >= BED_MIN_SECONDS
}

/// Turns voice-over spans `(start, end)` in seconds into a gain envelope.
pub fn duck_plan(spans: &[(f64, f64)], duck: Option<Duck>) -> DuckPlan {
    let Some(duck) = duck else { return Vec::new() };
    let low = 10f64.powf(-duck.amount.abs() / 20.0);
    let mut sorted: Vec<(f64, f64)> = spans.iter().copied().filter(|(s, e)| e > s).collect();
    sorted.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut merged: Vec<(f64, f64)> = Vec::new();
    for (s, e) in sorted {
        match merged.last_mut() {
            // a gap shorter than release + attack would pump, so hold the dip
            Some(last) if s - last.1 < duck.attack + duck.release => last.1 = last.1.max(e),
            _ => merged.push((s, e)),
        }
    }
    merged
        .into_iter()
        .flat_map(|(s, e)| {
            [
                (s - duck.attack, 1.0),
                (s, low),
                (e, low),
                (e + duck.release, 1.0),
            ]
        })
        .collect()
}

pub fn duck_gain_at(plan: &[(f64, f64)], t: f64) -> f64 {
    let (Some(first), Some(last)) = (plan.first(), plan.last()) else {
        return 1.0;
    };
    if t <= first.0 || t >= last.0 {
        return 1.0;
    }
    let hi = plan.partition_point(|p| p.0 <= t);
    let (t0, g0) = plan[hi - 1];
    let (t1, g1) = plan[hi];
    if t1 == t0 {
        g1
    } else {
        g0 + (g1 - g0) * (t - t0) / (t1 - t0)
    }
}

type Biquad = [f64; 5]; // b0 b1 b2 a1 a2

fn k_weighting(sr: u32) -> (Biquad, Biquad) {
    // ITU-R BS.1770-4 pre-filter and RLB filter, derived for any sample rate
    let sr = sr as f64;
    let (f0, g, q) = (1681.974450955533, 3.999843853973347, 0.7071752369554196);
    let k = (std::f64::consts::PI * f0 / sr).tan();
    let vh = 10f64.powf(g / 20.0);
    let vb = vh.powf(0.4996667741545416);
    let a0 = 1.0 + k / q + k * k;
    let shelf = [
        (vh + vb * k / q + k * k) / a0,
        2.0 * (k * k - vh) / a0,
        (vh - vb * k / q + k * k) / a0,
        2.0 * (k * k - 1.0) / a0,
        (1.0 - k / q + k * k) / a0,
    ];
    let (f0, q) = (38.13547087602444, 0.5003270373238773);
    let k = (std::f64::consts::PI * f0 / sr).tan();
    let a0 = 1.0 + k / q + k * k;
    let highpass = [
        1.0,
        -2.0,
        1.0,
        2.0 * (k * k - 1.0) / a0,
        (1.0 - k / q + k * k) / a0,
    ];
    (shelf, highpass)
}

/// Integrated loudness (LUFS) of interleaved stereo; `-inf` for silence.
pub fn measure_loudness(stereo: &[f32], sr: u32) -> f64 {
    let frames = stereo.len() / 2;
    let step = (sr as f64 * 0.1).round() as usize; // 100 ms hop, 400 ms blocks
    let segments = frames / step;
    if segments < 4 {
        return f64::NEG_INFINITY;
    }
    let mut energy = vec![0.0f64; segments];
    let (s, h) = k_weighting(sr);
    for ch in 0..2 {
        let (mut x1, mut x2, mut y1, mut y2, mut z1, mut z2) = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        for (seg, acc_out) in energy.iter_mut().enumerate() {
            let mut acc = 0.0;
            for i in seg * step..(seg + 1) * step {
                let xi = stereo[i * 2 + ch] as f64;
                let y = s[0] * xi + s[1] * x1 + s[2] * x2 - s[3] * y1 - s[4] * y2;
                x2 = x1;
                x1 = xi;
                let z = h[0] * y + h[1] * y1 + h[2] * y2 - h[3] * z1 - h[4] * z2;
                y2 = y1;
                y1 = y;
                z2 = z1;
                z1 = z;
                acc += z * z;
            }
            *acc_out += acc;
        }
    }
    let blocks: Vec<f64> = energy
        .windows(4)
        .map(|w| w.iter().sum::<f64>() / (4 * step) as f64)
        .collect();
    let lufs = |z: f64| -0.691 + 10.0 * z.log10();
    let mean = |xs: &[f64]| xs.iter().sum::<f64>() / xs.len() as f64;
    let abs: Vec<f64> = blocks
        .into_iter()
        .filter(|&z| z > 0.0 && lufs(z) > -70.0)
        .collect();
    if abs.is_empty() {
        return f64::NEG_INFINITY;
    }
    let relative = lufs(mean(&abs)) - 10.0;
    let gated: Vec<f64> = abs.into_iter().filter(|&z| lufs(z) > relative).collect();
    lufs(mean(&gated))
}

pub const LIMITER_LOOKAHEAD: f64 = 0.005;
pub const LIMITER_RELEASE: f64 = 0.08;

pub fn peak(stereo: &[f32]) -> f32 {
    stereo.iter().fold(0.0f32, |p, s| p.max(s.abs()))
}

/// Look-ahead peak limiter, in place. The gain needed at each frame is held
/// over the look-ahead window and averaged over it, so it eases down before a
/// peak; it recovers linearly over the release time. No sample passes the ceiling.
pub fn limit(stereo: &mut [f32], sr: u32, ceiling_db: f64) {
    let ceiling = 10f32.powf(ceiling_db as f32 / 20.0);
    if peak(stereo) <= ceiling {
        return;
    }
    let n = stereo.len() / 2;
    let l = ((sr as f64 * LIMITER_LOOKAHEAD).round() as usize).max(1);
    let req: Vec<f32> = (0..n)
        .map(|i| {
            let m = stereo[i * 2].abs().max(stereo[i * 2 + 1].abs());
            if m > ceiling {
                ceiling / m
            } else {
                1.0
            }
        })
        .collect();
    // held[i] = min(req[i .. i+l-1]) via a monotonic deque
    let mut held = vec![1.0f32; n];
    let mut dq: std::collections::VecDeque<usize> = std::collections::VecDeque::new();
    for i in (0..n).rev() {
        while dq.back().is_some_and(|&j| req[j] >= req[i]) {
            dq.pop_back();
        }
        dq.push_back(i);
        while dq.front().is_some_and(|&j| j > i + l - 1) {
            dq.pop_front();
        }
        held[i] = req[*dq.front().unwrap()];
    }
    // the mean of held over the last l frames: every window covers i, so it is <= req[i]
    let inc = 1.0 / ((sr as f64 * LIMITER_RELEASE).round().max(1.0)) as f32;
    let mut sum = 0.0f64; // window total minus l (frames before 0 count as gain 1)
    let mut g = 1.0f32;
    for i in 0..n {
        sum += held[i] as f64 - if i >= l { held[i - l] as f64 } else { 1.0 };
        let avg = ((sum + l as f64) / l as f64) as f32;
        g = avg.min(g + inc).min(req[i]);
        stereo[i * 2] *= g;
        stereo[i * 2 + 1] *= g;
    }
}

#[derive(Debug, Clone, Copy)]
pub struct MasterReport {
    /// Integrated loudness before processing (LUFS).
    pub measured: f64,
    /// Gain applied before the limiter (dB).
    pub gain: f64,
    /// Integrated loudness after processing (LUFS).
    pub final_lufs: f64,
    /// Sample peak after processing (dBFS).
    pub peak: f64,
}

/// Normalises to the target loudness and limits, in place.
pub fn master(stereo: &mut [f32], sr: u32, mix: &MixSettings) -> MasterReport {
    let measured = measure_loudness(stereo, sr);
    let mut gain = 0.0;
    if let (Some(target), true) = (mix.loudness, measured.is_finite()) {
        gain = target - measured;
        let k = 10f32.powf(gain as f32 / 20.0);
        stereo.iter_mut().for_each(|s| *s *= k);
    }
    limit(stereo, sr, mix.ceiling);
    let p = peak(stereo);
    MasterReport {
        measured,
        gain,
        final_lufs: measure_loudness(stereo, sr),
        peak: if p > 0.0 {
            20.0 * (p as f64).log10()
        } else {
            f64::NEG_INFINITY
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: u32 = 48000;

    fn sine(seconds: f64, amplitude: f32) -> Vec<f32> {
        let n = (seconds * SR as f64).round() as usize;
        let mut out = Vec::with_capacity(n * 2);
        for i in 0..n {
            let s = amplitude * (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / SR as f32).sin();
            out.push(s);
            out.push(s);
        }
        out
    }

    #[test]
    fn measures_a_minus_20_dbfs_sine_as_minus_20_lufs() {
        let lufs = measure_loudness(&sine(5.0, 0.1), SR);
        assert!((lufs + 20.0).abs() < 0.5, "{lufs}");
    }

    #[test]
    fn gates_silence_out() {
        let mut s = sine(4.0, 0.1);
        s.extend(std::iter::repeat_n(0.0, SR as usize * 8));
        let lufs = measure_loudness(&s, SR);
        assert!((lufs + 20.0).abs() < 0.5, "{lufs}");
        assert_eq!(
            measure_loudness(&vec![0.0; SR as usize * 2], SR),
            f64::NEG_INFINITY
        );
    }

    #[test]
    fn limiter_keeps_samples_under_the_ceiling_and_leaves_quiet_audio_alone() {
        let mut loud = sine(1.0, 1.5);
        limit(&mut loud, SR, -1.0);
        let ceiling = 10f32.powf(-1.0 / 20.0);
        assert!(loud.iter().all(|s| s.abs() <= ceiling + 1e-6));

        let mut quiet = sine(1.0, 0.5);
        let before = quiet.clone();
        limit(&mut quiet, SR, -1.0);
        assert_eq!(quiet, before);
    }

    #[test]
    fn limiter_eases_in_before_a_peak() {
        let mut s = vec![0.5f32; SR as usize * 2];
        let spike = SR as usize; // frame SR/2
        s[spike] = 2.0;
        limit(&mut s, SR, -1.0);
        let before = s[spike - 240]; // 120 frames earlier
        assert!(before < 0.5 && before > 0.3, "{before}");
    }

    #[test]
    fn master_normalises_to_the_target() {
        let mut s = sine(6.0, 0.1);
        let report = master(&mut s, SR, &MixSettings::default());
        assert!((report.measured + 20.0).abs() < 0.5);
        assert!(
            (report.final_lufs + 14.0).abs() < 0.5,
            "{}",
            report.final_lufs
        );
        assert!(report.peak <= -1.0 + 1e-4);
    }

    #[test]
    fn duck_plan_holds_short_gaps_and_recovers() {
        let duck = MixSettings::default().duck.unwrap();
        let plan = duck_plan(&[(2.0, 4.0), (4.3, 6.0), (10.0, 11.0)], Some(duck));
        let low = 10f64.powf(-12.0 / 20.0);
        assert_eq!(duck_gain_at(&plan, 0.0), 1.0);
        assert!((duck_gain_at(&plan, 1.925) - (1.0 + low) / 2.0).abs() < 1e-6);
        assert!((duck_gain_at(&plan, 4.15) - low).abs() < 1e-9);
        assert!((duck_gain_at(&plan, 6.4) - 1.0).abs() < 1e-9);
        assert!((duck_gain_at(&plan, 10.5) - low).abs() < 1e-9);
        assert!(duck_plan(&[(1.0, 2.0)], None).is_empty());
    }

    #[test]
    fn decides_which_clips_duck() {
        assert!(is_voice("assets/audio/vo/a.mp3", None));
        assert!(is_voice("x.mp3", Some("vo")));
        assert!(should_duck("assets/audio/music/bed.mp3", None, None, 60.0));
        assert!(!should_duck(
            "assets/audio/music/whoosh.mp3",
            None,
            None,
            0.8
        ));
        assert!(should_duck(
            "assets/audio/music/hit.mp3",
            None,
            Some(true),
            0.8
        ));
        assert!(!should_duck(
            "assets/audio/music/bed.mp3",
            None,
            Some(false),
            60.0
        ));
        assert!(!should_duck(
            "assets/audio/music/x.mp3",
            Some("sfx"),
            None,
            60.0
        ));
        assert!(should_duck(
            "assets/audio/music/x.mp3",
            Some("music"),
            None,
            1.0
        ));
        assert!(!should_duck("assets/audio/vo/a.mp3", None, None, 60.0));
        assert!(!should_duck("assets/audio/music/sfx.wav", None, None, 60.0));
        assert!(!should_duck("assets/audio/sfx/hits.wav", None, None, 60.0));
        assert!(should_duck(
            "assets/audio/music/sfx-bed.wav",
            Some("music"),
            None,
            60.0
        ));
    }

    #[test]
    fn resolves_composition_mix_options() {
        let m = MixSettings::from_json(
            &serde_json::json!({ "loudness": false, "duck": { "amount": 18 } }),
        );
        assert_eq!(m.loudness, None);
        assert_eq!(m.duck.unwrap().amount, 18.0);
        assert_eq!(m.duck.unwrap().attack, 0.15);
        let off = MixSettings::from_json(&serde_json::json!({ "duck": false, "loudness": -16 }));
        assert!(off.duck.is_none());
        assert_eq!(off.loudness, Some(-16.0));
        assert_eq!(
            MixSettings::from_json(&serde_json::Value::Null),
            MixSettings::default()
        );
    }
}
