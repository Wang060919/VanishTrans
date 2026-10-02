pub(crate) const BALL_IDLE_WIDTH: f64 = 116.0;
pub(crate) const BALL_IDLE_HEIGHT: f64 = 42.0;
const BALL_POSITION_TOLERANCE: f64 = 8.0;
const BALL_TOP_GUTTER: f64 = 0.0;

pub(crate) fn default_ball_position_on_monitor(
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: i32,
    scale_factor: f64,
) -> (i32, i32) {
    let width = (BALL_IDLE_WIDTH * scale_factor).round() as i32;
    let gutter = (BALL_TOP_GUTTER * scale_factor).round() as i32;
    (
        monitor_x + (monitor_width - width).max(0) / 2,
        monitor_y + gutter,
    )
}

fn ball_position_bounds(
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: i32,
    monitor_height: i32,
    scale_factor: f64,
) -> (i32, i32, i32, i32) {
    let tolerance = (BALL_POSITION_TOLERANCE * scale_factor).round() as i32;
    let width = (BALL_IDLE_WIDTH * scale_factor).round() as i32;
    let height = (BALL_IDLE_HEIGHT * scale_factor).round() as i32;
    let min_x = monitor_x - tolerance;
    let min_y = monitor_y - tolerance;
    let max_x_exclusive = (monitor_x + monitor_width - (width - tolerance)).max(min_x + 1);
    let max_y_exclusive = (monitor_y + monitor_height - (height - tolerance)).max(min_y + 1);

    (min_x, max_x_exclusive, min_y, max_y_exclusive)
}

pub(crate) fn ball_position_is_visible(
    x: i32,
    y: i32,
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: i32,
    monitor_height: i32,
    scale_factor: f64,
) -> bool {
    let (min_x, max_x_exclusive, min_y, max_y_exclusive) = ball_position_bounds(
        monitor_x,
        monitor_y,
        monitor_width,
        monitor_height,
        scale_factor,
    );

    x >= min_x && x < max_x_exclusive && y >= min_y && y < max_y_exclusive
}

pub(crate) fn clamp_ball_position_to_monitor(
    x: i32,
    y: i32,
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: i32,
    monitor_height: i32,
    scale_factor: f64,
) -> Option<(i32, i32)> {
    let tolerance = (BALL_POSITION_TOLERANCE * scale_factor).round() as i32;
    if ball_position_is_visible(
        x,
        y,
        monitor_x,
        monitor_y,
        monitor_width,
        monitor_height,
        scale_factor,
    ) {
        let snapped_y = if y <= monitor_y + tolerance {
            monitor_y
        } else {
            y
        };
        return Some((x, snapped_y));
    }

    let monitor_right = monitor_x + monitor_width;
    let monitor_bottom = monitor_y + monitor_height;
    if x < monitor_x - tolerance
        || x >= monitor_right
        || y < monitor_y - tolerance
        || y >= monitor_bottom
    {
        return None;
    }

    let (min_x, max_x_exclusive, min_y, max_y_exclusive) = ball_position_bounds(
        monitor_x,
        monitor_y,
        monitor_width,
        monitor_height,
        scale_factor,
    );
    Some((
        x.clamp(min_x, max_x_exclusive - 1),
        y.clamp(min_y, max_y_exclusive - 1),
    ))
}

#[cfg(test)]
mod ball_position_tests {
    use super::{
        ball_position_is_visible, clamp_ball_position_to_monitor, default_ball_position_on_monitor,
    };

    #[test]
    fn defaults_to_the_top_center_of_the_monitor() {
        assert_eq!(default_ball_position_on_monitor(0, 0, 1920, 1.0), (902, 0));
        assert_eq!(
            default_ball_position_on_monitor(-2560, -200, 2560, 1.5),
            (-1367, -200)
        );
    }

    #[test]
    fn migrates_the_previous_top_gutter_to_the_monitor_edge() {
        assert_eq!(
            clamp_ball_position_to_monitor(902, 8, 0, 0, 1920, 1080, 1.0),
            Some((902, 0))
        );
        assert_eq!(
            clamp_ball_position_to_monitor(-1367, -188, -2560, -200, 2560, 1440, 1.5),
            Some((-1367, -200))
        );
    }

    #[test]
    fn keeps_an_already_visible_position() {
        assert_eq!(
            clamp_ball_position_to_monitor(100, 100, 0, 0, 1920, 1080, 1.0),
            Some((100, 100))
        );
    }

    #[test]
    fn migrates_a_legacy_right_edge_position() {
        let legacy_x = 1920 - 58;
        assert!(!ball_position_is_visible(
            legacy_x, 100, 0, 0, 1920, 1080, 1.0
        ));
        assert_eq!(
            clamp_ball_position_to_monitor(legacy_x, 100, 0, 0, 1920, 1080, 1.0),
            Some((1811, 100))
        );
    }

    #[test]
    fn migrates_a_scaled_legacy_right_edge_position() {
        let legacy_x = 2560 - (58.0_f64 * 1.5).round() as i32;
        assert_eq!(
            clamp_ball_position_to_monitor(legacy_x, 150, 0, 0, 2560, 1440, 1.5),
            Some((2397, 150))
        );
    }

    #[test]
    fn rejects_a_position_outside_the_monitor() {
        assert_eq!(
            clamp_ball_position_to_monitor(3000, 100, 0, 0, 1920, 1080, 1.0),
            None
        );
    }
}
