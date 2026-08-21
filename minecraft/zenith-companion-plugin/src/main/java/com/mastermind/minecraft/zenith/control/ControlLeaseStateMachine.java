package com.mastermind.minecraft.zenith.control;

import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

public final class ControlLeaseStateMachine {
    private final UUID serviceControllerUuid;
    private final Set<UUID> parentControllerUuids;
    private final Duration stableHandback;
    private final boolean nativeFallbackEnabled;
    private final boolean enhancedControllerEnabled;
    private final boolean parentTakeoverEnabled;
    private ControlLeaseSnapshot snapshot;

    public ControlLeaseStateMachine(
        boolean enabled,
        boolean nativeFallbackEnabled,
        boolean enhancedControllerEnabled,
        boolean parentTakeoverEnabled,
        UUID serviceControllerUuid,
        Set<UUID> parentControllerUuids,
        Duration stableHandback,
        Instant now
    ) {
        this.serviceControllerUuid = serviceControllerUuid;
        this.parentControllerUuids = Set.copyOf(parentControllerUuids);
        this.stableHandback = requirePositive(stableHandback);
        this.nativeFallbackEnabled = nativeFallbackEnabled;
        this.enhancedControllerEnabled = enhancedControllerEnabled;
        this.parentTakeoverEnabled = parentTakeoverEnabled;
        snapshot = new ControlLeaseSnapshot(
            enabled ? (nativeFallbackEnabled ? BodyDriver.ZENITH_FALLBACK : BodyDriver.RECOVERY_HOLD) : BodyDriver.DISABLED,
            null,
            false,
            false,
            false,
            Objects.requireNonNull(now, "now"),
            null
        );
    }

    public synchronized ControlLeaseSnapshot controllerSocketConnected(Instant now) {
        requireEnabled();
        snapshot = new ControlLeaseSnapshot(BodyDriver.RECOVERY_HOLD, null, true, false, false, now, null);
        return snapshot;
    }

    public synchronized ControlLeaseSnapshot controllerAuthenticated(UUID controllerUuid, Instant now) {
        requireEnabled();
        Objects.requireNonNull(controllerUuid, "controllerUuid");
        if (!snapshot.controllerSocketPresent()) {
            throw new IllegalStateException("Controller authentication requires a pending socket");
        }
        BodyDriver driver;
        boolean rejected = false;
        if (parentTakeoverEnabled && parentControllerUuids.contains(controllerUuid)) {
            driver = BodyDriver.HUMAN_PARENT;
        } else if (enhancedControllerEnabled && controllerUuid.equals(serviceControllerUuid)) {
            driver = BodyDriver.MASTERMIND_CONTROLLER;
        } else {
            driver = BodyDriver.RECOVERY_HOLD;
            rejected = true;
        }
        snapshot = new ControlLeaseSnapshot(driver, controllerUuid, true, !rejected, rejected, now, null);
        return snapshot;
    }

    public synchronized ControlLeaseSnapshot controllerDisconnected(Instant now) {
        requireEnabled();
        snapshot = new ControlLeaseSnapshot(BodyDriver.RECOVERY_HOLD, null, false, false, false, now, null);
        return snapshot;
    }

    public synchronized ControlLeaseSnapshot observeHandback(HandbackEvidence evidence, Instant now) {
        requireEnabled();
        Objects.requireNonNull(evidence, "evidence");
        if (snapshot.driver() != BodyDriver.RECOVERY_HOLD || snapshot.controllerSocketPresent()) {
            return snapshot;
        }
        if (!evidence.safe()) {
            snapshot = new ControlLeaseSnapshot(BodyDriver.RECOVERY_HOLD, null, false, false, false, now, null);
            return snapshot;
        }
        Instant stableSince = snapshot.stableSince() == null ? now : snapshot.stableSince();
        if (nativeFallbackEnabled && Duration.between(stableSince, now).compareTo(stableHandback) >= 0) {
            snapshot = new ControlLeaseSnapshot(BodyDriver.ZENITH_FALLBACK, null, false, false, false, now, stableSince);
        } else {
            snapshot = new ControlLeaseSnapshot(BodyDriver.RECOVERY_HOLD, null, false, false, false, snapshot.changedAt(), stableSince);
        }
        return snapshot;
    }

    public synchronized ControlLeaseSnapshot snapshot() {
        return snapshot;
    }

    private void requireEnabled() {
        if (snapshot.driver() == BodyDriver.DISABLED) {
            throw new IllegalStateException("Mastermind Zenith control lease is disabled");
        }
    }

    private static Duration requirePositive(Duration value) {
        Objects.requireNonNull(value, "stableHandback");
        if (value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException("Stable handback duration must be positive");
        }
        return value;
    }

    public record HandbackEvidence(
        boolean killSwitchClear,
        boolean bodyIdle,
        boolean zenithFresh,
        boolean serverFresh,
        boolean sourcesCorrelated
    ) {
        public boolean safe() {
            return killSwitchClear && bodyIdle && zenithFresh && serverFresh && sourcesCorrelated;
        }
    }
}
