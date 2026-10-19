/// Painted-shape description for a retained clip: a missing radius yields a
/// capsule (half the short side), a missing pad falls back to EDGE_BLEED.
/// `square_edges` names the sides flush with a screen edge whose painted
/// corners are squared — the clip unions a straight strip over those arcs.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BallClipSpec {
    pub(super) corner_radius: Option<f64>,
    pub(super) pad: Option<i32>,
    pub(super) square_edges: Option<Vec<String>>,
    pub(super) scale_factor: Option<f64>,
    pub(super) alignment: Option<ClipAlignment>,
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ClipAlignment {
    Left,
    Center,
    Right,
}
