package com.mastermind.minecraft.zenith.control;

import com.github.rfresh2.EventConsumer;
import com.mastermind.minecraft.zenith.MastermindZenithConfig;
import com.mastermind.minecraft.zenith.MastermindZenithPlugin;
import com.zenith.Proxy;
import com.zenith.event.player.PlayerConnectedEvent;
import com.zenith.event.player.PlayerDisconnectedEvent;
import com.zenith.module.api.Module;
import com.zenith.network.server.ServerSession;
import net.kyori.adventure.text.Component;
import org.geysermc.mcprotocollib.auth.GameProfile;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import static com.github.rfresh2.EventConsumer.of;
import static com.zenith.Globals.*;

public final class ControlLeaseModule extends Module {
    private static final String ADMISSION_EVENT_CLASS = "com.zenith.event.player.ControllerAdmissionEvent";
    private static final String NATIVE_TICK_ADMISSION_EVENT_CLASS = "com.zenith.event.client.NativeBotTickAdmissionEvent";
    private static final ControlLeaseStateMachine.HandbackEvidence UNSAFE_HANDBACK =
        new ControlLeaseStateMachine.HandbackEvidence(false, false, false, false, false);

    private ControlLeaseStateMachine stateMachine;
    private ControllerAdmissionPolicy admissionPolicy;
    private HandbackAttestationReader attestationReader;
    private PairedHandbackEvaluator handbackEvaluator;
    private ServerSession pendingSession;
    private boolean preemptionHookAvailable;
    private boolean nativeTickAdmissionHookAvailable;
    private final AtomicBoolean handbackPollInFlight = new AtomicBoolean(false);
    private volatile long lastHandbackPollAt;

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
        if (config.parentTakeoverEnabled && !nativeTickAdmissionHookAvailable) {
            throw new IllegalStateException("Parent takeover requires the pinned native bot-tick admission core hook");
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
        if (config.pairedHandbackEnabled) {
            validateHandbackTiming(config);
            try {
                attestationReader = new HandbackAttestationReader(
                    Path.of(config.handbackAttestationFile),
                    Path.of(config.handbackKeyFile),
                    Path.of(config.handbackKillSwitchFile)
                );
            } catch (IOException | RuntimeException error) {
                throw new IllegalStateException("Paired handback files are unsafe or unavailable", error);
            }
            handbackEvaluator = new PairedHandbackEvaluator(
                parseRequiredUuid(config.serviceControllerUuid, "serviceControllerUuid"),
                config.handbackMaximumAgeMilliseconds,
                config.handbackMaximumPositionDelta
            );
        }
    }

    @Override
    public void onDisable() {
        BARITONE.stop();
        if (attestationReader != null) attestationReader.close();
        attestationReader = null;
        handbackEvaluator = null;
        handbackPollInFlight.set(false);
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
        nativeTickAdmissionConsumer().ifPresent(events::add);
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

    @SuppressWarnings({"rawtypes", "unchecked"})
    private Optional<EventConsumer<?>> nativeTickAdmissionConsumer() {
        if (isNativeTickAdmissionHookAvailable()) {
            try {
                Class eventClass = Class.forName(NATIVE_TICK_ADMISSION_EVENT_CLASS);
                nativeTickAdmissionHookAvailable = true;
                MastermindZenithPlugin.log.info("Pinned native bot-tick admission hook detected");
                return Optional.of(of(eventClass, this::onNativeTickAdmission));
            } catch (ClassNotFoundException impossible) {
                throw new IllegalStateException("Native bot-tick admission hook disappeared during module registration", impossible);
            }
        }
        nativeTickAdmissionHookAvailable = false;
        MastermindZenithPlugin.log.warn("Pinned native bot-tick admission hook is unavailable; recovery hold cannot enable");
        return Optional.empty();
    }

    public static boolean isNativeTickAdmissionHookAvailable() {
        try {
            Class.forName(NATIVE_TICK_ADMISSION_EVENT_CLASS);
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
            ControlLeaseSnapshot snapshot = stateMachine.controllerDisconnected(Instant.now());
            pendingSession = null;
            info("Controller disconnected; lease entered {} pending paired handback", snapshot.driver());
        }
    }

    private void onNativeTickAdmission(Object event) {
        ControlLeaseStateMachine machine = stateMachine;
        ControlLeaseSnapshot snapshot = machine == null ? null : machine.snapshot();
        if (snapshot != null && snapshot.driver() == BodyDriver.ZENITH_FALLBACK) return;
        try {
            event.getClass().getMethod("deny").invoke(event);
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Native bot-tick admission hook failed closed", error);
        }
        BARITONE.stop();
        if (snapshot != null
            && snapshot.driver() == BodyDriver.RECOVERY_HOLD
            && !snapshot.controllerSocketPresent()
            && attestationReader != null
            && handbackEvaluator != null) {
            scheduleHandbackPoll(machine);
        }
    }

    private void scheduleHandbackPoll(ControlLeaseStateMachine machine) {
        long now = System.currentTimeMillis();
        if (now - lastHandbackPollAt < MastermindZenithPlugin.config.handbackPollMilliseconds) return;
        if (!handbackPollInFlight.compareAndSet(false, true)) return;
        lastHandbackPollAt = now;
        PairedHandbackEvaluator.LocalBodyObservation local = captureLocalObservation(now);
        EXECUTOR.execute(() -> {
            try {
                if (stateMachine != machine || attestationReader == null || handbackEvaluator == null) return;
                var attestation = attestationReader.read();
                long observedAt = System.currentTimeMillis();
                var evaluation = handbackEvaluator.evaluate(attestation, local, observedAt);
                if (!evaluation.shouldObserve()) return;
                ControlLeaseSnapshot before = machine.snapshot();
                ControlLeaseSnapshot after = machine.observeHandback(evaluation.evidence(), Instant.ofEpochMilli(observedAt));
                if (before.driver() != BodyDriver.ZENITH_FALLBACK && after.driver() == BodyDriver.ZENITH_FALLBACK) {
                    info("Stable authenticated paired telemetry admitted ZENITH_FALLBACK");
                }
            } catch (IOException | RuntimeException error) {
                if (stateMachine == machine) machine.observeHandback(UNSAFE_HANDBACK, Instant.now());
            } finally {
                handbackPollInFlight.set(false);
            }
        });
    }

    private PairedHandbackEvaluator.LocalBodyObservation captureLocalObservation(long now) {
        var player = CACHE.getPlayerCache();
        var worldName = CACHE.getChunkCache().getWorldName();
        boolean playerAvailable = player.getThePlayer() != null;
        return new PairedHandbackEvaluator.LocalBodyObservation(
            now,
            worldName == null ? "mastermind:unknown" : worldName.toString(),
            playerAvailable ? player.getX() : 0,
            playerAvailable ? player.getY() : 0,
            playerAvailable ? player.getZ() : 0,
            Proxy.getInstance().isConnected(),
            playerAvailable && player.isAlive(),
            playerAvailable && BOT.isOnGround(),
            !BARITONE.isActive() && !INPUTS.hasActiveRequest(),
            attestationReader != null && attestationReader.killSwitchClear()
        );
    }

    private static void validateHandbackTiming(MastermindZenithConfig config) {
        if (config.handbackPollMilliseconds < 50 || config.handbackPollMilliseconds > 5_000) {
            throw new IllegalArgumentException("handbackPollMilliseconds must be between 50 and 5000");
        }
        if (config.handbackMaximumAgeMilliseconds < config.handbackPollMilliseconds * 2
            || config.handbackMaximumAgeMilliseconds > 60_000) {
            throw new IllegalArgumentException("handbackMaximumAgeMilliseconds is incompatible with the poll interval");
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
