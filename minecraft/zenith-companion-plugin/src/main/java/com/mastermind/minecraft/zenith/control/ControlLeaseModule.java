package com.mastermind.minecraft.zenith.control;

import com.github.rfresh2.EventConsumer;
import com.mastermind.minecraft.zenith.MastermindZenithConfig;
import com.mastermind.minecraft.zenith.MastermindZenithPlugin;
import com.zenith.event.player.PlayerConnectedEvent;
import com.zenith.event.player.PlayerDisconnectedEvent;
import com.zenith.module.api.Module;
import com.zenith.network.server.ServerSession;
import net.kyori.adventure.text.Component;
import org.geysermc.mcprotocollib.auth.GameProfile;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static com.github.rfresh2.EventConsumer.of;
import static com.zenith.Globals.BARITONE;

public final class ControlLeaseModule extends Module {
    private static final String ADMISSION_EVENT_CLASS = "com.zenith.event.player.ControllerAdmissionEvent";

    private ControlLeaseStateMachine stateMachine;
    private ControllerAdmissionPolicy admissionPolicy;
    private ServerSession pendingSession;
    private boolean preemptionHookAvailable;

    @Override
    public boolean enabledSetting() {
        return MastermindZenithPlugin.config.enabled;
    }

    @Override
    public void onEnable() {
        MastermindZenithConfig config = MastermindZenithPlugin.config;
        if (config.parentTakeoverEnabled && !preemptionHookAvailable) {
            throw new IllegalStateException("Parent takeover requires the pinned Zenith controller-admission core hook");
        }
        UUID serviceControllerUuid = config.enhancedControllerEnabled
            ? parseRequiredUuid(config.serviceControllerUuid, "serviceControllerUuid")
            : null;
        Set<UUID> parentControllerUuids = config.parentTakeoverEnabled
            ? parseUuidSet(config.parentControllerUuids)
            : Set.of();
        admissionPolicy = new ControllerAdmissionPolicy(
            config.enhancedControllerEnabled,
            config.parentTakeoverEnabled,
            serviceControllerUuid,
            parentControllerUuids
        );
        stateMachine = new ControlLeaseStateMachine(
            true,
            config.nativeFallbackEnabled,
            config.enhancedControllerEnabled,
            config.parentTakeoverEnabled,
            serviceControllerUuid,
            parentControllerUuids,
            Duration.ofMillis(config.handbackStableMilliseconds),
            Instant.now()
        );
    }

    @Override
    public void onDisable() {
        BARITONE.stop();
        pendingSession = null;
        admissionPolicy = null;
        stateMachine = null;
    }

    @Override
    public List<EventConsumer<?>> registerEvents() {
        List<EventConsumer<?>> events = new ArrayList<>();
        events.add(of(PlayerConnectedEvent.class, this::onControllerAuthenticated));
        events.add(of(PlayerDisconnectedEvent.class, this::onControllerDisconnected));
        controllerAdmissionConsumer().ifPresent(events::add);
        return List.copyOf(events);
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private Optional<EventConsumer<?>> controllerAdmissionConsumer() {
        if (isControllerAdmissionHookAvailable()) {
            try {
                Class eventClass = Class.forName(ADMISSION_EVENT_CLASS);
                preemptionHookAvailable = true;
                MastermindZenithPlugin.log.info("Pinned controller-admission hook detected");
                return Optional.of(of(eventClass, this::onControllerAdmission));
            } catch (ClassNotFoundException impossible) {
                throw new IllegalStateException("Controller-admission hook disappeared during module registration", impossible);
            }
        }
        preemptionHookAvailable = false;
        MastermindZenithPlugin.log.warn("Pinned controller-admission hook is unavailable; parent takeover cannot enable");
        return Optional.empty();
    }

    public static boolean isControllerAdmissionHookAvailable() {
        try {
            Class.forName(ADMISSION_EVENT_CLASS);
            return true;
        } catch (ClassNotFoundException ignored) {
            return false;
        }
    }

    private void onControllerAdmission(Object event) {
        if (admissionPolicy == null) return;
        try {
            GameProfile candidate = (GameProfile) event.getClass().getMethod("candidateProfile").invoke(event);
            GameProfile current = (GameProfile) event.getClass().getMethod("currentProfile").invoke(event);
            ControllerAdmissionPolicy.Decision decision = admissionPolicy.decide(
                true,
                candidate.getId(),
                current.getId()
            );
            if (decision == ControllerAdmissionPolicy.Decision.PREEMPT_SERVICE_AND_ADMIT_PARENT) {
                BARITONE.stop();
                event.getClass().getMethod("allowPreemption").invoke(event);
                info("Authorized parent controller {} to preempt service controller {}", candidate.getId(), current.getId());
            }
        } catch (ReflectiveOperationException | RuntimeException error) {
            MastermindZenithPlugin.log.error("Controller-admission hook failed closed", error);
        }
    }

    private void onControllerAuthenticated(PlayerConnectedEvent event) {
        pendingSession = event.session();
        BARITONE.stop();
        stateMachine.controllerSocketConnected(Instant.now());
        ControlLeaseSnapshot snapshot = stateMachine.controllerAuthenticated(event.clientGameProfile().getId(), Instant.now());
        info("Controller lease entered {} for UUID {}", snapshot.driver(), event.clientGameProfile().getId());
        if (snapshot.rejected()) {
            event.session().disconnect(Component.text("Controller identity is not authorized by the Mastermind lease policy"));
        }
    }

    private void onControllerDisconnected(PlayerDisconnectedEvent event) {
        if (event.session() == pendingSession) {
            BARITONE.stop();
            stateMachine.controllerDisconnected(Instant.now());
            pendingSession = null;
        }
    }

    private static UUID parseRequiredUuid(String value, String label) {
        try {
            return UUID.fromString(value);
        } catch (RuntimeException error) {
            throw new IllegalArgumentException(label + " must be configured as a UUID before enabling the plugin", error);
        }
    }

    private static Set<UUID> parseUuidSet(List<String> values) {
        Set<UUID> result = new HashSet<>();
        for (String value : values) {
            result.add(parseRequiredUuid(value, "parentControllerUuids"));
        }
        if (result.isEmpty()) {
            throw new IllegalArgumentException("At least one parent controller UUID is required before enabling the plugin");
        }
        return result;
    }
}
