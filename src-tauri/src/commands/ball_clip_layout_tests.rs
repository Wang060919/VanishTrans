use super::*;

#[test]
fn delayed_clip_uses_its_measurement_scale_and_current_client_alignment() {
    for (source_scale, width, height, radius, pad) in
        [(1.25, 185, 53, 26, 10), (1.0, 148, 42, 21, 8)]
    {
        for (alignment, anchor) in [("left", 0.0), ("center", 0.5), ("right", 1.0)] {
            let clip: BallClipSpec = serde_json::from_value(serde_json::json!({
                "scaleFactor": source_scale, "alignment": alignment,
                "cornerRadius": radius, "pad": pad, "squareEdges": ["top"],
            }))
            .unwrap();
            let layout = ClipLayout::from_request(width, height, &clip).unwrap();
            for (dpi, client_width, capsule_width, capsule_height) in
                [(96, 564, 148, 42), (120, 706, 185, 53)]
            {
                let client = ClientGeometry {
                    width: client_width,
                    height: 678,
                    origin: POINT { x: 3, y: 7 },
                    dpi,
                };
                let (bounds, _, _) = layout.resolve(&client);
                let left = 3 + (f64::from(client_width - capsule_width) * anchor).round() as i32;
                assert_eq!((bounds.left, bounds.top), (left, 7));
                assert_eq!(
                    (bounds.right - bounds.left, bounds.bottom - bounds.top),
                    (capsule_width, capsule_height)
                );
                assert_eq!(layout.square_edges, ["top"]);
            }
        }
    }
}

#[test]
fn rejects_invalid_clip_scale_or_missing_alignment() {
    for scale in [0.0, -1.0, f64::INFINITY, f64::NAN] {
        let clip = BallClipSpec {
            corner_radius: None,
            pad: None,
            square_edges: None,
            scale_factor: Some(scale),
            alignment: Some(ClipAlignment::Center),
        };
        assert_eq!(
            ClipLayout::from_request(148, 42, &clip).err().unwrap().code,
            "VALIDATION"
        );
    }
    let clip: BallClipSpec =
        serde_json::from_value(serde_json::json!({"scaleFactor": 1.0})).unwrap();
    assert!(ClipLayout::from_request(148, 42, &clip).is_err());
}
