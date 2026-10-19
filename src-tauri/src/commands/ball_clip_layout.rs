use windows::Win32::Foundation::{POINT, RECT};

use super::window_clip::{BallClipSpec, ClipAlignment};
use crate::error::CommandError;

pub(super) struct ClientGeometry {
    pub width: i32,
    pub height: i32,
    pub origin: POINT,
    pub dpi: u32,
}

#[cfg(test)]
#[path = "ball_clip_layout_tests.rs"]
mod tests;

#[derive(Clone)]
pub(super) struct ClipLayout {
    width: f64,
    height: f64,
    top: f64,
    anchor: f64,
    radius: f64,
    pad: f64,
    pub square_edges: Vec<String>,
}

impl ClipLayout {
    pub fn new(
        client: &ClientGeometry,
        bounds: RECT,
        radius: i32,
        pad: i32,
        edges: &[String],
    ) -> Self {
        let scale = f64::from(client.dpi) / 96.0;
        let width = bounds.right - bounds.left;
        let gap = client.width - width;
        Self {
            width: f64::from(width) / scale,
            height: f64::from(bounds.bottom - bounds.top) / scale,
            top: f64::from(bounds.top - client.origin.y) / scale,
            // Preserve the painted alignment inside the retained viewport.
            // A full-width clip is centered until a business clip replaces it.
            anchor: if gap > 0 {
                (f64::from(bounds.left - client.origin.x) / f64::from(gap)).clamp(0.0, 1.0)
            } else {
                0.5
            },
            radius: f64::from(radius) / scale,
            pad: f64::from(pad.max(0)) / scale,
            square_edges: edges.to_vec(),
        }
    }

    pub fn from_request(
        width: u32,
        height: u32,
        clip: &BallClipSpec,
    ) -> Result<Self, CommandError> {
        let scale = clip
            .scale_factor
            .filter(|value| value.is_finite() && *value > 0.0)
            .ok_or_else(|| CommandError::validation("灵动岛裁剪倍率必须大于零"))?;
        let anchor = match clip.alignment {
            Some(ClipAlignment::Left) => 0.0,
            Some(ClipAlignment::Center) => 0.5,
            Some(ClipAlignment::Right) => 1.0,
            None => return Err(CommandError::validation("灵动岛裁剪缺少对齐方式")),
        };
        let radius = clip
            .corner_radius
            .filter(|value| value.is_finite() && *value >= 0.0)
            .unwrap_or(f64::from(width.min(height)) / 2.0);
        Ok(Self {
            width: f64::from(width) / scale,
            height: f64::from(height) / scale,
            // The CSS surface is always top-aligned. Old screen coordinates
            // may already be stale after Windows applies a DPI suggested rect.
            top: 0.0,
            anchor,
            radius: radius / scale,
            pad: f64::from(clip.pad.unwrap_or(super::ball_region::EDGE_BLEED).max(0)) / scale,
            square_edges: clip.square_edges.clone().unwrap_or_default(),
        })
    }

    pub fn resolve(&self, client: &ClientGeometry) -> (RECT, i32, i32) {
        let scale = f64::from(client.dpi) / 96.0;
        let width = ((self.width * scale).round() as i32).clamp(0, client.width);
        let height = ((self.height * scale).round() as i32).clamp(0, client.height);
        let left = client.origin.x + (f64::from(client.width - width) * self.anchor).round() as i32;
        let top =
            client.origin.y + ((self.top * scale).round() as i32).clamp(0, client.height - height);
        (
            RECT {
                left,
                top,
                right: left + width,
                bottom: top + height,
            },
            ((self.radius * scale).round() as i32).clamp(0, width.min(height) / 2),
            (self.pad * scale).ceil() as i32,
        )
    }
}
