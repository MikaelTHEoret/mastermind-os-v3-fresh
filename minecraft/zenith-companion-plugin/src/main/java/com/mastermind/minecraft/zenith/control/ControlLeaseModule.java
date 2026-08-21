package com.mastermind.minecraft.zenith.control;

import com.github.rfresh2.EventConsumer;
import com.mastermind.minecraft.zenith.MastermindZenithConfig;
import com.mastermind.minecraft.zenith.MastermindZenithPlugin;
import com.zenith.event.player.PlayerConnectedEvent;
import com.zenith.event.player.PlayerDisconnectedEvent;
import com.zenith.module.api.Module;
import com.zenith.network.server.ServerSession;
import net.kyori.adventure.text.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static com.github.rfresh2.EventConsumer.of;
import static com.zenith.Globals.BARITONE;

public final class ControlLeaseModule extends Module {
    private ControlLeaseStateMachine stateMachine;
    private ServerSession pendingSession;

    @Override
    public boolean enabledSetting() {
        return MastermindZenithPlugin.config.enabled;
    }

    @Override
    public void onEnable() {
        MastermindZenithConfig config = MastermindZenithPlugin.config;
        stateMachine = new ControlLeaseStateMachine(
            true,
            config.nativeFallbackEnabled,
            config.enhancedControllerEnabled,
            config.parentTakeoverEnabled,
            config.enhancedControllerEnabled ? parseRequiredUuid(config.serviceControllerUuid, "serviceControllerUuid") : null,
            config.parentTakeoverEnabled ? parseUuidSet(config.parentControllerUuids) : Set.of(),
            Duration.ofMillis(config.handbackStableMilliseconds),
            Instant.now()
        );
    }

    @Override
    public void onDisable() {
        BARITONE.stop();
        pendingSession = null;
        stateMachine = null;
    }

    @Override
    public List<EventConsumer<?>> registerEvents() {
        return List.of(
            of(PlayerConnectedEvent.class, this::onControllerAuthenticated),
            of(PlayerDisconnectedEvent.class, this::onControllerDisconnected)
        );
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
