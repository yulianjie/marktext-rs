use std::{ffi::c_void, ptr::NonNull};
use wayland_client::{
    backend::ObjectId,
    protocol::{wl_compositor, wl_region, wl_registry, wl_surface},
    Connection, Dispatch, EventQueue, Proxy, QueueHandle, WEnum,
};
use wayland_protocols::ext::background_effect::v1::client::{
    ext_background_effect_manager_v1 as ext_manager,
    ext_background_effect_surface_v1 as ext_surface,
};
use wayland_protocols_plasma::blur::client::{
    org_kde_kwin_blur as kde_blur, org_kde_kwin_blur_manager as kde_manager,
};

#[derive(Default)]
struct Registry {
    globals: Vec<(u32, String)>,
    blur_capability: bool,
}

impl Dispatch<wl_registry::WlRegistry, ()> for Registry {
    fn event(
        state: &mut Self,
        _: &wl_registry::WlRegistry,
        event: wl_registry::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            wl_registry::Event::Global {
                name, interface, ..
            } => state.globals.push((name, interface)),
            wl_registry::Event::GlobalRemove { name } => {
                state.globals.retain(|(id, _)| *id != name)
            }
            _ => (),
        }
    }
}
impl Dispatch<ext_manager::ExtBackgroundEffectManagerV1, ()> for Registry {
    fn event(
        state: &mut Self,
        _: &ext_manager::ExtBackgroundEffectManagerV1,
        event: ext_manager::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let ext_manager::Event::Capabilities { flags } = event {
            state.blur_capability = match flags {
                WEnum::Value(flags) => flags.contains(ext_manager::Capability::Blur),
                WEnum::Unknown(bits) => bits & 1 != 0,
            };
        }
    }
}
wayland_client::delegate_noop!(Registry: ignore wl_compositor::WlCompositor);
wayland_client::delegate_noop!(Registry: ignore wl_region::WlRegion);
wayland_client::delegate_noop!(Registry: ignore ext_surface::ExtBackgroundEffectSurfaceV1);
wayland_client::delegate_noop!(Registry: ignore kde_manager::OrgKdeKwinBlurManager);
wayland_client::delegate_noop!(Registry: ignore kde_blur::OrgKdeKwinBlur);

enum Effect {
    Standard(
        ext_surface::ExtBackgroundEffectSurfaceV1,
        ext_manager::ExtBackgroundEffectManagerV1,
    ),
    Kde(kde_blur::OrgKdeKwinBlur),
}

pub(super) struct Blur {
    connection: Connection,
    queue: EventQueue<Registry>,
    registry: Registry,
    global: u32,
    effect: Effect,
}

impl Blur {
    /// Pointers must belong to the same live GTK connection and stay live
    /// until this guard is dropped. Never assumes ownership of GTK objects.
    pub(super) unsafe fn new(
        display: NonNull<c_void>,
        surface: NonNull<c_void>,
    ) -> anyhow::Result<Option<Self>> {
        let backend = unsafe {
            wayland_backend::client::Backend::from_foreign_display(display.as_ptr().cast())
        };
        let connection = Connection::from_backend(backend);
        let id = unsafe {
            ObjectId::from_ptr(wl_surface::WlSurface::interface(), surface.as_ptr().cast())
        }?;
        let surface = wl_surface::WlSurface::from_id(&connection, id)?;
        let mut queue = connection.new_event_queue::<Registry>();
        let qh = queue.handle();
        let wire_registry = connection.display().get_registry(&qh, ());
        let mut registry = Registry::default();
        queue.roundtrip(&mut registry)?;
        let standard = registry
            .globals
            .iter()
            .find(|(_, interface)| interface == "ext_background_effect_manager_v1")
            .map(|(id, _)| *id);
        let kde = registry
            .globals
            .iter()
            .find(|(_, interface)| interface == "org_kde_kwin_blur_manager")
            .map(|(id, _)| *id);
        let (global, effect) = if let Some(global) = standard {
            let manager = wire_registry.bind::<ext_manager::ExtBackgroundEffectManagerV1, _, _>(
                global,
                1,
                &qh,
                (),
            );
            queue.roundtrip(&mut registry)?;
            if !registry.blur_capability {
                manager.destroy();
                connection.flush()?;
                return Ok(None);
            }
            let Some((compositor, _)) = registry
                .globals
                .iter()
                .find(|(_, interface)| interface == "wl_compositor")
            else {
                manager.destroy();
                connection.flush()?;
                return Ok(None);
            };
            let compositor =
                wire_registry.bind::<wl_compositor::WlCompositor, _, _>(*compositor, 1, &qh, ());
            let region = compositor.create_region(&qh, ());
            // The protocol clips to the surface; covers resizing without ever
            // committing GTK's wl_surface on GTK's behalf.
            region.add(0, 0, i32::MAX, i32::MAX);
            let effect = manager.get_background_effect(&surface, &qh, ());
            effect.set_blur_region(Some(&region));
            region.destroy();
            (global, Effect::Standard(effect, manager))
        } else if let Some(global) = kde {
            let manager =
                wire_registry.bind::<kde_manager::OrgKdeKwinBlurManager, _, _>(global, 1, &qh, ());
            let effect = manager.create(&surface, &qh, ());
            effect.set_region(None);
            effect.commit();
            (global, Effect::Kde(effect))
        } else {
            return Ok(None);
        };
        connection.flush()?;
        Ok(Some(Self {
            connection,
            queue,
            registry,
            global,
            effect,
        }))
    }

    pub(super) fn available(&mut self) -> anyhow::Result<bool> {
        // GTK reads the shared display. Dispatch only our pending queue;
        // never block GTK waiting for events during capability monitoring.
        self.connection.backend().dispatch_inner_queue()?;
        self.queue.dispatch_pending(&mut self.registry)?;
        Ok(self
            .registry
            .globals
            .iter()
            .any(|(id, _)| *id == self.global)
            && (!matches!(self.effect, Effect::Standard(..)) || self.registry.blur_capability))
    }
}

impl Drop for Blur {
    fn drop(&mut self) {
        match &self.effect {
            Effect::Standard(effect, manager) => {
                effect.destroy();
                manager.destroy();
            }
            Effect::Kde(effect) => effect.release(),
        }
        let _ = self.connection.flush();
    }
}
