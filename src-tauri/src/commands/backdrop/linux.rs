//! GTK owns the native surface. Only request effects on that surface, never
//! capture the screen or change the user's compositor configuration.

mod wayland;

use gtk::prelude::*;
use raw_window_handle::{HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle};
use std::{
    cell::RefCell,
    collections::HashMap,
    rc::{Rc, Weak},
    time::Duration,
};
use tauri::Emitter;
use x11rb::{
    connection::Connection,
    protocol::xproto::{AtomEnum, ConnectionExt, PropMode},
    wrapper::ConnectionExt as _,
};

thread_local! {
    static WINDOWS: RefCell<HashMap<String, Weak<RefCell<Blur>>>> = RefCell::new(HashMap::new());
}

enum Blur {
    X11 {
        connection: x11rb::rust_connection::RustConnection,
        root: u32,
        atom: u32,
        selection: u32,
    },
    Wayland(wayland::Blur),
}

impl Blur {
    fn available(&mut self) -> anyhow::Result<bool> {
        match self {
            Self::X11 {
                connection,
                root,
                atom,
                selection,
            } => Ok(
                connection.get_selection_owner(*selection)?.reply()?.owner != 0
                    && connection
                        .list_properties(*root)?
                        .reply()?
                        .atoms
                        .contains(atom),
            ),
            Self::Wayland(blur) => blur.available(),
        }
    }
}

pub(super) fn enable(window: &tauri::WebviewWindow) -> anyhow::Result<bool> {
    if let Some(state) =
        WINDOWS.with(|all| all.borrow().get(window.label()).and_then(Weak::upgrade))
    {
        return state.borrow_mut().available();
    }
    let gtk = window.gtk_window()?;
    // This function is called on GTK's main thread before first paint.
    gtk.realize();
    let state = match (
        window.window_handle()?.as_raw(),
        window.display_handle()?.as_raw(),
    ) {
        (RawWindowHandle::Xlib(handle), RawDisplayHandle::Xlib(_)) => {
            let (connection, _) = x11rb::connect(None)?;
            let xid = u32::try_from(handle.window)?;
            let root = connection.get_geometry(xid)?.reply()?.root;
            let screen = connection
                .setup()
                .roots
                .iter()
                .position(|screen| screen.root == root)
                .ok_or_else(|| anyhow::anyhow!("X11 window is on a different display"))?;
            let atom = connection
                .intern_atom(false, b"_KDE_NET_WM_BLUR_BEHIND_REGION")?
                .reply()?
                .atom;
            let selection = connection
                .intern_atom(false, format!("_NET_WM_CM_S{screen}").as_bytes())?
                .reply()?
                .atom;
            // KWin advertises the enabled effect on the root window. An atom
            // merely existing is not evidence that a compositor supports it.
            if connection.get_selection_owner(selection)?.reply()?.owner == 0
                || !connection
                    .list_properties(root)?
                    .reply()?
                    .atoms
                    .contains(&atom)
            {
                return Ok(false);
            }
            connection
                .change_property32(PropMode::REPLACE, xid, atom, AtomEnum::CARDINAL, &[])?
                .check()?;
            connection.flush()?;
            Blur::X11 {
                connection,
                root,
                atom,
                selection,
            }
        }
        (RawWindowHandle::Wayland(surface), RawDisplayHandle::Wayland(display)) => {
            // SAFETY: GTK owns both pointers, this runs on its main thread,
            // and the state is dropped in GTK's destroy callback below.
            let Some(blur) = (unsafe { wayland::Blur::new(display.display, surface.surface) })?
            else {
                return Ok(false);
            };
            Blur::Wayland(blur)
        }
        _ => return Ok(false),
    };
    let state = Rc::new(RefCell::new(state));
    WINDOWS.with(|all| {
        all.borrow_mut()
            .insert(window.label().to_owned(), Rc::downgrade(&state))
    });
    let weak = Rc::downgrade(&state);
    let target = window.clone();
    let mut previous = true;
    let timer = gtk::glib::timeout_add_local(Duration::from_secs(2), move || {
        let Some(state) = weak.upgrade() else {
            return gtk::glib::ControlFlow::Break;
        };
        let active = state.borrow_mut().available().unwrap_or(false);
        if active != previous {
            previous = active;
            let _ = target.emit_to(target.label(), "mt://window/backdrop", active);
        }
        gtk::glib::ControlFlow::Continue
    });
    let label = window.label().to_owned();
    // Drop protocol objects while the GTK display is still alive. Do not
    // destroy the wl_surface or disconnect GTK's borrowed wl_display.
    let cleanup = RefCell::new(Some((timer, state)));
    gtk.connect_destroy(move |_| {
        if let Some((timer, state)) = cleanup.borrow_mut().take() {
            timer.remove();
            WINDOWS.with(|all| all.borrow_mut().remove(&label));
            drop(state);
        }
    });
    gtk.queue_draw();
    Ok(true)
}
