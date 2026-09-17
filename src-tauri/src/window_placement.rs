//! Keep window controls reachable after saved geometry or display changes.
//!
//! Tauri has no cross-platform display-topology event. Sample the small monitor
//! list once a second and repair only after it changes, never during ordinary
//! window dragging. Explicit opens also repair geometry before taking focus.

use std::time::Duration;

// All callers run off the native event loop. Serialize a topology pass with an
// explicit open/focus so their multi-step DPI/size updates cannot interleave.
static PLACEMENT_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

use tauri::{
    AppHandle, LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl Rect {
    fn right(self) -> i64 {
        i64::from(self.x) + i64::from(self.width)
    }

    fn bottom(self) -> i64 {
        i64::from(self.y) + i64::from(self.height)
    }

    fn overlap(self, other: Self) -> (i64, i64) {
        (
            (self.right().min(other.right()) - i64::from(self.x.max(other.x))).max(0),
            (self.bottom().min(other.bottom()) - i64::from(self.y.max(other.y))).max(0),
        )
    }

    fn center(self, size: PhysicalSize<u32>) -> PhysicalPosition<i32> {
        PhysicalPosition::new(
            (i64::from(self.x) + i64::from(self.width.saturating_sub(size.width)) / 2) as i32,
            (i64::from(self.y) + i64::from(self.height.saturating_sub(size.height)) / 2) as i32,
        )
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Display {
    name: Option<String>,
    bounds: Rect,
    work: Rect,
    scale: f64,
}

impl From<&Monitor> for Display {
    fn from(monitor: &Monitor) -> Self {
        let work = monitor.work_area();
        Self {
            name: monitor.name().cloned(),
            bounds: Rect {
                x: monitor.position().x,
                y: monitor.position().y,
                width: monitor.size().width,
                height: monitor.size().height,
            },
            work: Rect {
                x: work.position.x,
                y: work.position.y,
                width: work.size.width,
                height: work.size.height,
            },
            scale: monitor.scale_factor(),
        }
    }
}

fn displays(monitors: &[Monitor]) -> Vec<Display> {
    let mut result: Vec<_> = monitors
        .iter()
        .map(Display::from)
        .filter(|d| d.work.width > 0 && d.work.height > 0)
        .collect();
    // Enumeration order is not part of the desktop layout.
    result.sort_by_key(|d| (d.bounds.x, d.bounds.y, d.name.clone()));
    result
}

fn reachable(rect: Rect, display: &Display, maximized: bool, fullscreen: bool) -> bool {
    let area = if fullscreen {
        display.bounds
    } else {
        display.work
    };
    let (width, height) = rect.overlap(area);
    // Maximized Windows frames extend a few physical pixels beyond the work
    // area. Ordinary windows must expose their title bar, not just a corner.
    let frame = if maximized {
        (16.0 * display.scale).ceil() as i64
    } else {
        0
    };
    i64::from(rect.y) >= i64::from(area.y) - frame
        && width >= i64::from(rect.width).min((320.0 * display.scale).ceil() as i64)
        && height >= i64::from(rect.height).min((200.0 * display.scale).ceil() as i64)
}

fn recovery_display<'a>(
    rect: Rect,
    displays: &'a [Display],
    preferred: Option<&Display>,
    maximized: bool,
    fullscreen: bool,
) -> Option<&'a Display> {
    if rect.width == 0 || rect.height == 0 {
        return None;
    }
    if let Some(preferred) = preferred.and_then(|p| displays.iter().find(|d| *d == p)) {
        return (!reachable(rect, preferred, maximized, fullscreen)).then_some(preferred);
    }
    if displays
        .iter()
        .any(|d| reachable(rect, d, maximized, fullscreen))
    {
        return None;
    }
    // Keep a partly visible window on its existing screen. For fully detached
    // windows use the nearest remaining work area (also works left/above zero).
    displays.iter().max_by_key(|d| {
        let (w, h) = rect.overlap(d.work);
        let dx = (i64::from(d.work.x) - rect.right())
            .max(i64::from(rect.x) - d.work.right())
            .max(0);
        let dy = (i64::from(d.work.y) - rect.bottom())
            .max(i64::from(rect.y) - d.work.bottom())
            .max(0);
        (
            i128::from(w) * i128::from(h),
            -(i128::from(dx).pow(2) + i128::from(dy).pow(2)),
        )
    })
}

/// Does not show, focus or unminimize a window. Background recovery must not
/// steal focus or resurrect a window the user deliberately minimized.
pub fn ensure_reachable(window: &WebviewWindow, preferred: Option<&Monitor>) -> tauri::Result<()> {
    let _guard = PLACEMENT_LOCK.lock();
    if window.is_minimized()? {
        return Ok(());
    }
    let monitors = displays(&window.available_monitors()?);
    let position = window.outer_position()?;
    let outer = window.outer_size()?;
    let rect = Rect {
        x: position.x,
        y: position.y,
        width: outer.width,
        height: outer.height,
    };
    let maximized = window.is_maximized()?;
    let fullscreen = window.is_fullscreen()?;
    let preferred = preferred.map(Display::from);
    let Some(target) = recovery_display(rect, &monitors, preferred.as_ref(), maximized, fullscreen)
    else {
        return Ok(());
    };

    if fullscreen {
        window.set_fullscreen(false)?;
    }
    if maximized {
        window.unmaximize()?;
    }
    let scale = window.scale_factor()?;
    let inner = window.inner_size()?;
    let logical: LogicalSize<f64> = inner.to_logical(scale);
    // Move first: Windows changes the frame and DPI while crossing monitors.
    window.set_position(target.work.center(PhysicalSize::new(0, 0)))?;
    let outer = window.outer_size()?;
    let inner = window.inner_size()?;
    let frame_w = outer.width.saturating_sub(inner.width);
    let frame_h = outer.height.saturating_sub(inner.height);
    let capacity = PhysicalSize::new(
        target.work.width.saturating_sub(frame_w).max(1),
        target.work.height.saturating_sub(frame_h).max(1),
    );
    let (min_w, min_h): (f64, f64) = if window.label() == "settings" {
        (760.0, 560.0)
    } else {
        (800.0, 600.0)
    };
    // On small/high-DPI screens the configured minimum can exceed the work
    // area. Relax it just enough for this screen before requesting a size.
    window.set_min_size(Some(LogicalSize::new(
        min_w.min(f64::from(capacity.width) / target.scale),
        min_h.min(f64::from(capacity.height) / target.scale),
    )))?;
    let desired: PhysicalSize<u32> = logical.to_physical(target.scale);
    window.set_size(PhysicalSize::new(
        desired.width.min(capacity.width),
        desired.height.min(capacity.height),
    ))?;
    window.set_position(target.work.center(window.outer_size()?))?;
    if maximized {
        window.maximize()?;
    }
    if fullscreen {
        window.set_fullscreen(true)?;
    }
    tracing::debug!(
        label = window.label(),
        "recovered window into an available display work area"
    );
    Ok(())
}

pub fn show(window: &WebviewWindow, preferred: Option<&Monitor>) -> tauri::Result<()> {
    if window.is_minimized()? {
        window.unminimize()?;
    }
    // Display enumeration can temporarily fail during a dock transition. Do
    // not turn that into a startup failure; the topology watcher retries.
    if let Err(error) = ensure_reachable(window, preferred) {
        tracing::warn!(%error, label = window.label(), "failed to recover window before showing");
    }
    window.show()?;
    window.set_focus()
}

pub fn watch_displays(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut previous = Vec::new();
        let mut retry = false;
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let Ok(monitors) = app.available_monitors() else {
                continue;
            };
            let current = displays(&monitors);
            // Display drivers can briefly report no outputs during hotplug.
            if current.is_empty() {
                continue;
            }
            let changed = current != previous;
            if changed || retry {
                for window in app.webview_windows().into_values() {
                    if window.is_visible().unwrap_or(false) {
                        if let Err(error) = ensure_reachable(&window, None) {
                            tracing::debug!(%error, label = window.label(), "display recovery deferred");
                        }
                    }
                }
            }
            // A second pass lets the OS finish its own asynchronous relocation.
            retry = changed;
            previous = current;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(x: i32, y: i32, width: u32, height: u32, scale: f64) -> Display {
        let bounds = Rect {
            x,
            y,
            width,
            height,
        };
        Display {
            name: None,
            bounds,
            work: Rect {
                height: height - 40,
                ..bounds
            },
            scale,
        }
    }

    #[test]
    fn disconnected_first_of_three_displays_recovers_to_a_remaining_screen() {
        let screens = [
            display(0, 0, 1920, 1080, 1.0),
            display(1920, 0, 1920, 1080, 1.0),
        ];
        let settings = Rect {
            x: -1700,
            y: 100,
            width: 900,
            height: 700,
        };
        assert_eq!(
            recovery_display(settings, &screens, None, false, false),
            Some(&screens[0])
        );
    }

    #[test]
    fn a_visible_corner_does_not_make_an_inaccessible_title_bar_reachable() {
        let screens = [
            display(0, 0, 2560, 1440, 1.0),
            display(2560, -2, 2560, 1440, 1.0),
        ];
        let saved = Rect {
            x: 1878,
            y: -1157,
            width: 2400,
            height: 1509,
        };
        assert!(recovery_display(saved, &screens, None, false, false).is_some());
    }

    #[test]
    fn usable_secondary_and_spanning_windows_stay_where_the_user_put_them() {
        let screens = [
            display(-1920, 0, 1920, 1080, 1.0),
            display(0, 0, 1920, 1080, 1.0),
        ];
        for x in [-1700, -500] {
            let rect = Rect {
                x,
                y: 100,
                width: 900,
                height: 700,
            };
            assert!(recovery_display(rect, &screens, None, false, false).is_none());
        }
    }

    #[test]
    fn explicit_settings_open_uses_requesting_editors_screen() {
        let screens = [
            display(0, 0, 1920, 1080, 1.0),
            display(1920, 0, 1920, 1080, 1.0),
        ];
        let settings = Rect {
            x: 100,
            y: 100,
            width: 900,
            height: 700,
        };
        assert_eq!(
            recovery_display(settings, &screens, Some(&screens[1]), false, false),
            Some(&screens[1])
        );
        assert!(recovery_display(settings, &screens, Some(&screens[0]), false, false).is_none());
    }

    #[test]
    fn taskbar_and_mixed_dpi_are_accounted_for() {
        let mut screen = display(0, -1440, 2560, 1440, 2.0);
        screen.work.y += 80;
        screen.work.height -= 80;
        let rect = Rect {
            x: 100,
            y: -1440,
            width: 1800,
            height: 1400,
        };
        assert!(!reachable(rect, &screen, false, false));
        assert!(reachable(rect, &screen, false, true));
        let sliver = Rect {
            x: 2500,
            y: -1200,
            ..rect
        };
        assert!(!reachable(sliver, &screen, false, false));
    }

    #[test]
    fn maximized_frame_outside_work_area_is_not_displaced() {
        let screen = display(0, 0, 1920, 1080, 1.25);
        let rect = Rect {
            x: -10,
            y: -10,
            width: 1940,
            height: 1060,
        };
        assert!(reachable(rect, &screen, true, false));
        assert!(!reachable(rect, &screen, false, false));
    }

    #[test]
    fn transient_empty_monitor_list_does_not_invent_a_destination() {
        let rect = Rect {
            x: 5000,
            y: 5000,
            width: 900,
            height: 700,
        };
        assert!(recovery_display(rect, &[], None, false, false).is_none());
    }
}
